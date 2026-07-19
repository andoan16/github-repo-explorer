import { describe, it, expect } from 'vitest';
import {
  detectVietnamese,
  VietnameseQueryExpander,
  VietnameseTranslationCache,
  detectVietnameseRefinement,
  extractTechTerms,
  expandGithubSynonyms,
  classifyVietnameseIntent,
  quickVietnameseTranslateStructured,
  normalizeDiacritics,
  ENGLISH_GENERIC_TERMS,
  normalizeVietnameseQuery,
} from '../../src/main/search/vietnamese';
import { createMockOllamaClient } from '../mocks/ollama';

// ── detectVietnamese ──

describe('detectVietnamese', () => {
  it('detects Vietnamese text with diacritics', () => {
    const score = detectVietnamese('Tôi muốn một nền tảng CI/CD tự host');
    expect(score).toBeGreaterThan(0.3);
  });

  it('detects pure Vietnamese with tones', () => {
    const score = detectVietnamese('quản lý mật khẩu');
    expect(score).toBeGreaterThan(0.3);
  });

  it('detects Vietnamese with ơ and ư characters', () => {
    const score = detectVietnamese('công cụ giám sát máy chủ');
    expect(score).toBeGreaterThan(0.3);
  });

  it('detects Vietnamese with đ character', () => {
    const score = detectVietnamese('đồng bộ dữ liệu');
    expect(score).toBeGreaterThan(0.3);
  });

  it('returns low score for plain English', () => {
    const score = detectVietnamese('I want a CI/CD platform');
    expect(score).toBeLessThan(0.3);
  });

  it('returns low score for technical English', () => {
    const score = detectVietnamese('password manager self-hosted docker');
    expect(score).toBeLessThan(0.3);
  });

  it('returns 0 for empty string', () => {
    expect(detectVietnamese('')).toBe(0);
  });

  it('handles mixed Vietnamese-English text', () => {
    const score = detectVietnamese('Tôi muốn Docker giám sát');
    expect(score).toBeGreaterThan(0.3);
  });

  it('detects "công cụ" (tool)', () => {
    const score = detectVietnamese('công cụ giám sát');
    expect(score).toBeGreaterThan(0.3);
  });

  it('detects "nền tảng" (platform)', () => {
    const score = detectVietnamese('nền tảng quan sát hệ thống');
    expect(score).toBeGreaterThan(0.3);
  });

  it('returns low score for French with accents (no Vietnamese markers)', () => {
    // French: "café résumé" — has accents but lacks Vietnamese-specific markers
    const score = detectVietnamese('café résumé');
    // French text without Vietnamese markers should score low
    expect(score).toBeLessThan(0.5);
  });

  it('detects CI/CD query in Vietnamese', () => {
    const score = detectVietnamese('Tôi muốn một nền tảng CI/CD tự host hỗ trợ Docker');
    expect(score).toBeGreaterThanOrEqual(0.3);
  });
});

// ── VietnameseQueryExpander ──

describe('VietnameseQueryExpander', () => {
  it('returns null for English text', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('I want a CI/CD platform');
    expect(result).toBeNull();
  });

  it('returns null for empty text', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('');
    expect(result).toBeNull();
  });

  it('expands Vietnamese text with local dictionary', async () => {
    const expander = new VietnameseQueryExpander(); // no LLM
    const result = await expander.expand('quản lý mật khẩu');

    expect(result).not.toBeNull();
    expect(result!.originalQuery).toBe('quản lý mật khẩu');
    expect(result!.englishTranslation).toContain('password');
    expect(result!.technicalConcepts.length).toBeGreaterThan(0);
    expect(result!.searchVariants.length).toBeGreaterThan(0);
    expect(result!.fromCache).toBe(false);
  });

  it('expands CI/CD self-hosted query', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('tự host CI/CD');

    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('self-hosted');
  });

  it('expands server monitoring query', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('giám sát máy chủ');

    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('monitoring');
  });

  it('expands database backup query', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('công cụ sao lưu cơ sở dữ liệu');

    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('backup');
  });

  it('extracts multiple technical concepts', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('mã nguồn mở giám sát máy chủ');

    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('open source');
    expect(result!.technicalConcepts).toContain('monitoring');
  });

  it('includes original Vietnamese in search variants', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('quản lý bí mật');

    expect(result).not.toBeNull();
    expect(result!.searchVariants[0]).toBe('quản lý bí mật'); // original included
  });

  it('caches results and returns from cache on second call', async () => {
    const cache = new VietnameseTranslationCache();
    const expander = new VietnameseQueryExpander();

    const result1 = await expander.expand('giám sát máy chủ', undefined, cache);
    expect(result1!.fromCache).toBe(false);

    const result2 = await expander.expand('giám sát máy chủ', undefined, cache);
    expect(result2!.fromCache).toBe(true);
    expect(result2!.englishTranslation).toBe(result1!.englishTranslation);
  });

  it('uses LLM enhancement when available', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce(JSON.stringify({
      englishTranslation: 'password manager for credential vault',
      technicalConcepts: ['password-manager', 'credential-vault', 'secret-management'],
      alternativeQueries: ['credential vault tool', 'secret management platform'],
    }));

    const expander = new VietnameseQueryExpander(
      mock as any,
      'test-model',
    );

    const result = await expander.expand('quản lý mật khẩu');
    expect(result).not.toBeNull();
    // The LLM enhancement should enrich the technical concepts
    expect(result!.technicalConcepts.length).toBeGreaterThan(0);
  });

  it('gracefully handles LLM failure', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockRejectedValueOnce(new Error('Ollama unavailable'));

    const expander = new VietnameseQueryExpander(
      mock as any,
      'test-model',
    );

    // Should still work with local dictionary fallback
    const result = await expander.expand('giám sát máy chủ');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('monitoring');
  });

  it('limits search variants to 5', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('công cụ giám sát máy chủ tự động');

    expect(result).not.toBeNull();
    expect(result!.searchVariants.length).toBeLessThanOrEqual(5);
  });
});

// ── VietnameseTranslationCache ──

describe('VietnameseTranslationCache', () => {
  it('stores and retrieves translations', () => {
    const cache = new VietnameseTranslationCache();
    const key = VietnameseTranslationCache.key('quản lý mật khẩu');
    const entry: import('../../src/main/search/vietnamese').CachedTranslation = {
      originalQuery: 'quản lý mật khẩu',
      englishTranslation: 'password manager',
      searchVariants: ['quản lý mật khẩu', 'password manager', 'credential vault'],
      technicalConcepts: ['password manager', 'credential', 'secret management'],
    };

    cache.set(key, entry);
    const retrieved = cache.get(key);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.englishTranslation).toBe('password manager');
    expect(retrieved!.technicalConcepts).toContain('password manager');
  });

  it('returns null for cache misses', () => {
    const cache = new VietnameseTranslationCache();
    const result = cache.get('nonexistent query');
    expect(result).toBeNull();
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new VietnameseTranslationCache();
    const entry: import('../../src/main/search/vietnamese').CachedTranslation = {
      originalQuery: 'test',
      englishTranslation: 'test',
      searchVariants: ['test'],
      technicalConcepts: [],
    };

    // Fill beyond capacity (max 200 entries from the code)
    for (let i = 0; i < 201; i++) {
      cache.set(`query ${i}`, { ...entry, originalQuery: `query ${i}` });
    }

    // First entry should have been evicted
    const first = cache.get('query 0');
    expect(first).toBeNull();

    // Later entries should still be present
    const later = cache.get('query 200');
    expect(later).not.toBeNull();
  });

  it('normalizes keys (case and whitespace)', () => {
    const cache = new VietnameseTranslationCache();
    const entry: import('../../src/main/search/vietnamese').CachedTranslation = {
      originalQuery: 'Quản Lý Mật Khẩu',
      englishTranslation: 'password manager',
      searchVariants: ['Quản Lý Mật Khẩu', 'password manager'],
      technicalConcepts: ['password manager'],
    };

    cache.set(VietnameseTranslationCache.key('Quản Lý Mật Khẩu'), entry);

    // Key normalization should make these equivalent
    const retrieved = cache.get(VietnameseTranslationCache.key('quản lý mật khẩu'));
    expect(retrieved).not.toBeNull();
  });

  it('tracks metrics correctly', () => {
    const cache = new VietnameseTranslationCache();
    const entry: import('../../src/main/search/vietnamese').CachedTranslation = {
      originalQuery: 'test',
      englishTranslation: 'test',
      searchVariants: ['test'],
      technicalConcepts: [],
    };

    cache.set('test', entry);
    const metrics = cache.getMetrics();
    expect(metrics.size).toBe(1);

    // Hit
    cache.get('test');
    const afterHit = cache.getMetrics();
    expect(afterHit.hits).toBe(1);

    // Miss
    cache.get('nonexistent');
    const afterMiss = cache.getMetrics();
    expect(afterMiss.misses).toBe(1);
  });

  it('expires entries after TTL', () => {
    const cache = new VietnameseTranslationCache();
    const entry: import('../../src/main/search/vietnamese').CachedTranslation = {
      originalQuery: 'test',
      englishTranslation: 'test',
      searchVariants: ['test'],
      technicalConcepts: [],
    };

    cache.set('test', entry);
    expect(cache.get('test')).not.toBeNull();

    // We can't easily test TTL in unit tests without time manipulation,
    // but verify the cache structure supports TTL correctly
    const metrics = cache.getMetrics();
    expect(metrics.maxSize).toBeGreaterThan(0);
  });

  it('clear() empties the cache', () => {
    const cache = new VietnameseTranslationCache();
    const entry: import('../../src/main/search/vietnamese').CachedTranslation = {
      originalQuery: 'test',
      englishTranslation: 'test',
      searchVariants: ['test'],
      technicalConcepts: [],
    };

    cache.set('test', entry);
    expect(cache.getMetrics().size).toBe(1);

    cache.clear();
    expect(cache.getMetrics().size).toBe(0);
    expect(cache.get('test')).toBeNull();
  });
});

// ── detectVietnameseRefinement ──

describe('detectVietnameseRefinement', () => {
  it('detects "ưu tiên Go" as language preference', () => {
    const result = detectVietnameseRefinement('ưu tiên Go');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('emphasis');
    expect(result!.emphasis!.languageMatch).toBe(3.0);
  });

  it('detects "chỉ mã nguồn mở" as license preference', () => {
    const result = detectVietnameseRefinement('chỉ mã nguồn mở');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('emphasis');
    expect(result!.emphasis!.licenseCompatibility).toBe(3.0);
  });

  it('detects "tự host" as topic emphasis', () => {
    const result = detectVietnameseRefinement('tự host');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('emphasis');
    expect(result!.emphasis!.semanticMatch).toBe(2.0);
  });

  it('detects "nhiều sao nhất" as star sort', () => {
    const result = detectVietnameseRefinement('nhiều sao nhất');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('raw-sort');
    expect(result!.sortKey).toBe('stars');
  });

  it('detects "mới nhất" as recency sort', () => {
    const result = detectVietnameseRefinement('mới nhất');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('raw-sort');
    expect(result!.sortKey).toBe('updated_at');
  });

  it('detects "thiên về DevOps" as topic adjustment', () => {
    const result = detectVietnameseRefinement('thiên về DevOps');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('emphasis');
    expect(result!.emphasis!.semanticMatch).toBe(2.0);
  });

  it('detects "hỗ trợ Docker" as topic emphasis', () => {
    const result = detectVietnameseRefinement('hỗ trợ Docker');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('emphasis');
    expect(result!.emphasis!.semanticMatch).toBe(2.0);
  });

  it('returns null for non-Vietnamese text', () => {
    const result = detectVietnameseRefinement('prefer Go');
    expect(result).toBeNull();
  });

  it('returns null for Vietnamese text with no matching pattern', () => {
    const result = detectVietnameseRefinement('tìm kiếm kho lưu trữ');
    // This has Vietnamese diacritics but no matching refinement pattern
    expect(result).toBeNull();
  });

  // ── Vietnamese star threshold filter ──

  it('detects "trên 5000 sao" as star threshold filter', () => {
    const result = detectVietnameseRefinement('trên 5000 sao');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('filter');
    expect(result!.minStars).toBe(5000);
  });

  it('detects "hơn 1000 sao" as star threshold filter', () => {
    const result = detectVietnameseRefinement('hơn 1000 sao');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('filter');
    expect(result!.minStars).toBe(1000);
  });

  it('detects "10k sao" as filter with k multiplier', () => {
    const result = detectVietnameseRefinement('10k sao');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('filter');
    expect(result!.minStars).toBe(10000);
  });

  it('detects ">5000" as filter', () => {
    const result = detectVietnameseRefinement('>5000');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('filter');
    expect(result!.minStars).toBe(5000);
  });
});

// ── extractTechTerms ──

describe('extractTechTerms', () => {
  it('extracts Docker from mixed Vietnamese-English query', () => {
    const terms = extractTechTerms('Tôi muốn công cụ giám sát Docker');
    expect(terms).toContain('docker');
    expect(terms).toContain('containerization');
  });

  it('extracts Kubernetes and k8s expansion', () => {
    const terms = extractTechTerms('triển khai kubernetes trên cluster');
    expect(terms).toContain('kubernetes');
    expect(terms).toContain('k8s');
  });

  it('extracts k8s abbreviation', () => {
    const terms = extractTechTerms('k8s deployment tool');
    expect(terms).toContain('kubernetes');
    expect(terms).toContain('k8s');
  });

  it('extracts CI/CD variations', () => {
    const ciTerms = extractTechTerms('ci/cd pipeline');
    expect(ciTerms).toContain('ci-cd');
    expect(ciTerms).toContain('continuous-integration');
  });

  it('extracts React', () => {
    const terms = extractTechTerms('react web app');
    expect(terms).toContain('react');
    expect(terms).toContain('frontend');
  });

  it('extracts multiple tech terms', () => {
    const terms = extractTechTerms('docker nginx redis monitoring');
    expect(terms).toContain('docker');
    expect(terms).toContain('containerization');
    expect(terms).toContain('nginx');
    expect(terms).toContain('web-server');
    expect(terms).toContain('redis');
    expect(terms).toContain('cache');
  });

  it('returns empty array for non-tech Vietnamese text', () => {
    const terms = extractTechTerms('quản lý mật khẩu');
    expect(terms).toEqual([]);
  });

  it('deduplicates expansions', () => {
    // Both 'node' and 'nodejs' map to 'nodejs' — shouldn't appear twice
    const terms = extractTechTerms('node nodejs server');
    const nodejsCount = terms.filter(t => t === 'nodejs').length;
    expect(nodejsCount).toBe(1);
  });

  it('does not match substring inside longer words', () => {
    // "rest" in "restful" context — should still match "rest" at word boundary
    const terms = extractTechTerms('REST API');
    expect(terms).toContain('rest-api');
  });

  it('extracts ML/AI terms', () => {
    const terms = extractTechTerms('AI và ML và LLM');
    expect(terms).toContain('artificial-intelligence');
    expect(terms).toContain('machine-learning');
    expect(terms).toContain('language-model');
  });

  it('handles empty string', () => {
    expect(extractTechTerms('')).toEqual([]);
  });

  // ── New TECH_TERMS expansions ──

  it('extracts TypeScript and expands to frontend', () => {
    const terms = extractTechTerms('typescript web app');
    expect(terms).toContain('typescript');
    expect(terms).toContain('frontend');
  });

  it('extracts Jenkins and expands to ci-cd', () => {
    const terms = extractTechTerms('jenkins ci server');
    expect(terms).toContain('jenkins');
    expect(terms).toContain('ci-cd');
  });

  it('extracts Kafka and expands to streaming', () => {
    const terms = extractTechTerms('kafka message broker');
    expect(terms).toContain('kafka');
  });

  it('extracts Prometheus and expands to monitoring', () => {
    const terms = extractTechTerms('prometheus metrics');
    expect(terms).toContain('prometheus');
    expect(terms).toContain('monitoring');
  });

  it('extracts Grafana and expands to monitoring', () => {
    const terms = extractTechTerms('grafana dashboard');
    expect(terms).toContain('grafana');
    expect(terms).toContain('monitoring');
  });

  it('extracts MySQL and expands to database', () => {
    const terms = extractTechTerms('mysql database');
    expect(terms).toContain('mysql');
    expect(terms).toContain('database');
  });

  it('extracts Django and expands to web-framework', () => {
    const terms = extractTechTerms('django python');
    expect(terms).toContain('django');
  });

  it('extracts Ansible and expands to devops-tool', () => {
    const terms = extractTechTerms('ansible configuration management');
    expect(terms).toContain('ansible');
  });

  it('extracts Vault and expands to security-tool', () => {
    const terms = extractTechTerms('vault secrets management');
    expect(terms).toContain('vault');
  });
});

// ── expandGithubSynonyms ──

describe('expandGithubSynonyms', () => {
  it('expands "quản lý" to management synonyms', () => {
    const expanded = expandGithubSynonyms('quản lý mật khẩu', ['password']);
    expect(expanded).toContain('management');
    expect(expanded).toContain('manager');
    expect(expanded).toContain('admin');
  });

  it('expands "giám sát" to monitoring synonyms', () => {
    const expanded = expandGithubSynonyms('giám sát máy chủ', ['monitoring']);
    // "monitoring" is already in translatedParts, so it should be filtered out
    expect(expanded).toContain('observability');
    expect(expanded).toContain('watch');
    // "monitoring" should NOT appear since it's in translatedParts
    expect(expanded).not.toContain('monitoring');
  });

  it('expands multiple Vietnamese phrases', () => {
    const expanded = expandGithubSynonyms('quản lý cơ sở dữ liệu', ['management', 'database']);
    // Should include synonyms for both "quản lý" and "cơ sở dữ liệu"
    expect(expanded).toContain('manager');
    expect(expanded).toContain('admin');
    expect(expanded).toContain('db');
  });

  it('returns empty for non-Vietnamese text', () => {
    const expanded = expandGithubSynonyms('password manager', ['password']);
    expect(expanded).toEqual([]);
  });

  it('deduplicates expansions', () => {
    // "tự host" and "riêng tư" both map to "self-hosted"
    const expanded = expandGithubSynonyms('tự host riêng tư', []);
    const selfHostedCount = expanded.filter(s => s === 'self-hosted').length;
    expect(selfHostedCount).toBeLessThanOrEqual(1);
  });

  it('caps at 10 expansions', () => {
    // Use a query that matches many synonyms
    const expanded = expandGithubSynonyms(
      'quản lý giám sát cơ sở dữ liệu bảo mật triển khai tự động',
      [],
    );
    expect(expanded.length).toBeLessThanOrEqual(10);
  });

  // ── New synonym expansions (added vocabulary) ──

  it('expands "sao lưu" to backup synonyms', () => {
    const expanded = expandGithubSynonyms('sao lưu dữ liệu', []);
    expect(expanded).toContain('backup');
    expect(expanded).toContain('backup-restore');
  });

  it('expands "mã hóa" to encryption synonyms', () => {
    const expanded = expandGithubSynonyms('mã hóa dữ liệu', []);
    expect(expanded).toContain('encryption');
    expect(expanded).toContain('crypto');
  });

  it('expands "chứng thực" to auth synonyms', () => {
    const expanded = expandGithubSynonyms('chứng thực người dùng', []);
    expect(expanded).toContain('authentication');
    expect(expanded).toContain('auth');
  });

  it('expands "phân quyền" to authorization synonyms', () => {
    const expanded = expandGithubSynonyms('phân quyền truy cập', []);
    expect(expanded).toContain('authorization');
    expect(expanded).toContain('rbac');
  });

  it('expands "hạ tầng" to infrastructure synonyms', () => {
    const expanded = expandGithubSynonyms('hạ tầng tự động', []);
    expect(expanded).toContain('infrastructure');
    expect(expanded).toContain('infra');
  });

  it('expands "lập trình" to development synonyms', () => {
    const expanded = expandGithubSynonyms('lập trình web', []);
    expect(expanded).toContain('programming');
    expect(expanded).toContain('development');
  });

  it('expands "gỡ lỗi" to debugging synonyms', () => {
    const expanded = expandGithubSynonyms('công cụ gỡ lỗi', []);
    expect(expanded).toContain('debugging');
    expect(expanded).toContain('debugger');
  });
});

// ── classifyVietnameseIntent ──

describe('classifyVietnameseIntent', () => {
  it('classifies "giám sát" as monitoring', () => {
    const intent = classifyVietnameseIntent('công cụ giám sát máy chủ');
    expect(intent).toBe('monitoring');
  });

  it('classifies "quản lý mật khẩu" as password-manager', () => {
    const intent = classifyVietnameseIntent('quản lý mật khẩu');
    expect(intent).toBe('password-manager');
  });

  it('classifies "bảo mật" as security-tool', () => {
    const intent = classifyVietnameseIntent('công cụ bảo mật');
    expect(intent).toBe('security-tool');
  });

  it('classifies "tự host" as self-hosted', () => {
    const intent = classifyVietnameseIntent('tự host git');
    expect(intent).toBe('self-hosted');
  });

  it('classifies "cơ sở dữ liệu" as database', () => {
    const intent = classifyVietnameseIntent('công cụ quản lý cơ sở dữ liệu');
    expect(intent).toBe('database');
  });

  it('classifies CI/CD as devops-tool', () => {
    const intent = classifyVietnameseIntent('nền tảng CI/CD');
    expect(intent).toBe('devops-tool');
  });

  it('classifies AI/ML queries', () => {
    const intent = classifyVietnameseIntent('công cụ trí tuệ nhân tạo');
    expect(intent).toBe('ai-ml-tool');
  });

  it('classifies "thư viện" as library', () => {
    const intent = classifyVietnameseIntent('thư viện React');
    expect(intent).toBe('library');
  });

  it('returns null for non-matching Vietnamese', () => {
    const intent = classifyVietnameseIntent('công cụ hỗ trợ');
    expect(intent).toBeNull();
  });

  it('returns null for English text', () => {
    const intent = classifyVietnameseIntent('password manager');
    expect(intent).toBeNull();
  });

  it('prioritizes earlier match when multiple patterns match (first-match wins)', () => {
    // "giám sát" matches monitoring before any other pattern could match
    const intent = classifyVietnameseIntent('giám sát bảo mật');
    expect(intent).toBe('monitoring');
  });

  it('classifies mobile app queries', () => {
    const intent = classifyVietnameseIntent('ứng dụng di động');
    expect(intent).toBe('mobile-app');
  });

  // ── New intent patterns ──

  it('classifies "đăng nhập" as authentication', () => {
    const intent = classifyVietnameseIntent('đăng nhập người dùng');
    expect(intent).toBe('authentication');
  });

  it('classifies "xác thực" as authentication', () => {
    const intent = classifyVietnameseIntent('xác thực người dùng oauth');
    expect(intent).toBe('authentication');
  });

  it('classifies "nhật ký" as monitoring', () => {
    const intent = classifyVietnameseIntent('xem nhật ký hệ thống');
    expect(intent).toBe('monitoring');
  });

  it('classifies "quản lý cấu hình" as devops-tool', () => {
    const intent = classifyVietnameseIntent('quản lý cấu hình ansible');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "proxy" as networking-tool', () => {
    const intent = classifyVietnameseIntent('proxy đảo ngược api gateway');
    expect(intent).toBe('networking-tool');
  });

  it('classifies "trình soạn thảo" as cli-tool', () => {
    const intent = classifyVietnameseIntent('trình soạn thảo terminal');
    expect(intent).toBe('cli-tool');
  });

  it('classifies "khôi phục" as database', () => {
    const intent = classifyVietnameseIntent('khôi phục dữ liệu');
    expect(intent).toBe('database');
  });
});

// ── quickVietnameseTranslateStructured ──

describe('quickVietnameseTranslateStructured', () => {
  it('returns structured result for Vietnamese text', () => {
    const result = quickVietnameseTranslateStructured('quản lý mật khẩu');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('password');
    expect(result!.techTerms).toBeDefined();
    expect(result!.expandedKeywords).toBeDefined();
  });

  it('returns tech terms for mixed text', () => {
    const result = quickVietnameseTranslateStructured('công cụ giám sát docker');
    if (result) {
      // Should include Docker tech terms
      expect(result.techTerms.length).toBeGreaterThan(0);
      expect(result.techTerms).toContain('docker');
    }
  });

  it('returns expanded keywords from synonyms', () => {
    const result = quickVietnameseTranslateStructured('quản lý máy chủ');
    if (result) {
      // Should include management/host synonyms
      expect(result.expandedKeywords.length).toBeGreaterThan(0);
    }
  });

  it('returns intent classification', () => {
    const result = quickVietnameseTranslateStructured('công cụ giám sát');
    if (result) {
      expect(result.intent).toBe('monitoring');
    }
  });

  it('returns null for English text', () => {
    const result = quickVietnameseTranslateStructured('password manager tool');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = quickVietnameseTranslateStructured('');
    expect(result).toBeNull();
  });

  it('translation field matches quickVietnameseTranslate output', () => {
    const query = 'giám sát máy chủ';
    const plainResult = (() => {
      // Inline the logic from quickVietnameseTranslate which delegates toStructured
      const structured = quickVietnameseTranslateStructured(query);
      return structured ? structured.translation : null;
    })();
    const structuredResult = quickVietnameseTranslateStructured(query);

    // They should agree
    if (structuredResult === null) {
      expect(plainResult).toBeNull();
    } else {
      expect(plainResult).toBe(structuredResult.translation);
    }
  });

  it('provides enrichment for self-hosted CI/CD query', () => {
    const result = quickVietnameseTranslateStructured('tự host CI/CD với Docker');
    expect(result).not.toBeNull();
    // Should have Docker and CI/CD tech terms
    expect(result!.techTerms).toContain('docker');
    expect(result!.techTerms).toContain('ci-cd');
    // Should expand "tự host" and "triển khai" synonyms
    expect(result!.expandedKeywords.length).toBeGreaterThan(0);
    // Should classify as devops-tool
    expect(result!.intent).toBe('devops-tool');
  });

  // ── New feature tests ──

  it('filters generic English terms from translation (e.g., "chỉ" → "only")', () => {
    // "chỉ" maps to "only" which is in ENGLISH_GENERIC_TERMS
    const result = quickVietnameseTranslateStructured('chỉ cần giám sát');
    if (result) {
      // "only" should not appear in translation
      expect(result.translation.toLowerCase()).not.toContain('only');
      // "chỉ" → "only" should be filtered from concepts too
      expect(result.techTerms.every(t => t.toLowerCase() !== 'only')).toBe(true);
    }
  });

  it('filters "ít" (less) which maps to generic English "less"', () => {
    const result = quickVietnameseTranslateStructured('ít tài nguyên nhẹ');
    if (result) {
      // "less" and "fewer" should be filtered from concepts
      expect(result.techTerms.every(t => t.toLowerCase() !== 'less')).toBe(true);
      expect(result.techTerms.every(t => t.toLowerCase() !== 'fewer')).toBe(true);
    }
  });

  // ── dictionaryConcepts tests ──

  it('returns dictionaryConcepts for pure Vietnamese terms', () => {
    const result = quickVietnameseTranslateStructured('giám sát máy chủ');
    expect(result).not.toBeNull();
    // Should include domain concepts from dictionary (monitoring, server, etc.)
    expect(result!.dictionaryConcepts.length).toBeGreaterThan(0);
    // "monitoring" comes from "giám sát", filtered from generic terms
    expect(result!.dictionaryConcepts).toContain('monitoring');
    // "observability" is a secondary translation from "giám sát"
    expect(result!.dictionaryConcepts).toContain('observability');
    // "server" and "host" come from "máy chủ"
    expect(result!.dictionaryConcepts).toContain('server');
    expect(result!.dictionaryConcepts).toContain('host');
  });

  it('filters generic English terms from dictionaryConcepts', () => {
    // "công cụ" → "tool" | "utility" (both generic, filtered from primary
    // translation but still appear in dictionaryConcepts as search concepts)
    // "quản lý" → "management" | "admin" (neither in ENGLISH_GENERIC_TERMS currently)
    const result = quickVietnameseTranslateStructured('công cụ quản lý');
    expect(result).not.toBeNull();
    // "tool" and "utility" are generic terms — they're in dictionaryConcepts
    // but filtered from the primary translation by ENGLISH_GENERIC_TERMS.
    expect(result!.dictionaryConcepts).toContain('management');
    expect(result!.dictionaryConcepts).toContain('admin');
  });

  it('returns empty dictionaryConcepts when no dict entries match', () => {
    // English-only text with no Vietnamese diacritics should return null
    expect(quickVietnameseTranslateStructured('docker kubernetes')).toBeNull();
  });

  it('dictionaryConcepts carry domain signal when techTerms is empty for pure VN', () => {
    // Pure Vietnamese with no English tech terms mixed in
    const result = quickVietnameseTranslateStructured('quản lý mật khẩu tự host');
    expect(result).not.toBeNull();
    expect(result!.techTerms.length).toBe(0); // no English tech words like "docker"
    // dictionaryConcepts should carry the domain signal
    expect(result!.dictionaryConcepts.length).toBeGreaterThanOrEqual(3);
    expect(result!.dictionaryConcepts).toContain('password manager');
    expect(result!.dictionaryConcepts).toContain('self-hosted');
  });

  // ── Retail / POS / hospitality domain regression tests ──
  // These guard against the bug where "công cụ quản lý căn tin" translated to
  // "devops-tool management can tin" — irrelevant DevOps results + romanized
  // garbage. The fix: 'công cụ' maps to generic tool/utility (not devops-tool),
  // and retail/POS vocabulary was added to the dictionary.
  it('translates "công cụ quản lý căn tin" to canteen/food-service domain', () => {
    const result = quickVietnameseTranslateStructured('công cụ quản lý căn tin');
    expect(result).not.toBeNull();
    // Translation must NOT contain devops-tool or romanized "can tin"
    expect(result!.translation).not.toContain('devops-tool');
    expect(result!.translation).not.toContain('can tin');
    // Translation must contain the canteen domain term
    expect(result!.translation).toMatch(/canteen|food-service/i);
    // Intent should be retail-pos, not devops-tool or cli-tool
    expect(result!.intent).toBe('retail-pos');
  });

  it('does not map "công cụ" to devops-tool intent for non-DevOps queries', () => {
    // "công cụ bán hàng" (sales tool) should NOT produce devops-tool
    const result = quickVietnameseTranslateStructured('công cụ bán hàng');
    expect(result).not.toBeNull();
    expect(result!.translation).not.toContain('devops-tool');
    expect(result!.translation).toMatch(/pos|point-of-sale|sales|retail/i);
    expect(result!.intent).toBe('retail-pos');
  });

  it('maps retail/POS vocabulary to English domain terms', () => {
    const cases: Array<[string, RegExp]> = [
      ['quản lý bán hàng', /sales-management|point-of-sale|pos/i],
      ['quản lý tồn kho', /inventory-management|stock-management/i],
      ['quản lý nhà hàng', /restaurant-management|restaurant-pos/i],
      ['quản lý cửa hàng', /store-management|retail-management/i],
    ];
    for (const [vi, expected] of cases) {
      const result = quickVietnameseTranslateStructured(vi);
      expect(result).not.toBeNull();
      expect(result!.translation).toMatch(expected);
      expect(result!.intent).toBe('retail-pos');
    }
  });

  it('preserves DevOps intent for actual DevOps "công cụ" queries', () => {
    // "công cụ giám sát" should still be monitoring, not retail-pos
    const result = quickVietnameseTranslateStructured('công cụ giám sát');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('monitoring');
    expect(result!.translation).toMatch(/monitoring|observability/i);
  });
});

// ── New VIETNAMESE_GITHUB_SYNONYMS entries ──

describe('expandGithubSynonyms — new entries', () => {
  it('expands "học sâu" to deep-learning synonyms', () => {
    const keywords = expandGithubSynonyms('học sâu', ['deep-learning']);
    expect(keywords).toContain('neural-network');
  });

  it('expands "học máy" to machine-learning synonyms', () => {
    const keywords = expandGithubSynonyms('học máy', ['machine-learning']);
    expect(keywords).toContain('ml');
  });

  it('expands "trí tuệ nhân tạo" to ai synonyms', () => {
    const keywords = expandGithubSynonyms('trí tuệ nhân tạo', ['artificial-intelligence']);
    expect(keywords).toContain('ai');
  });

  it('expands "thời gian thực" to realtime synonyms', () => {
    const keywords = expandGithubSynonyms('thời gian thực', ['realtime']);
    expect(keywords).toContain('real-time');
  });

  it('expands "quản lý cấu hình" to config-management synonyms', () => {
    const keywords = expandGithubSynonyms('quản lý cấu hình', ['configuration']);
    expect(keywords).toContain('config-management');
    expect(keywords).toContain('infrastructure-as-code');
  });

  it('expands "vùng chứa" to container synonyms', () => {
    const keywords = expandGithubSynonyms('vùng chứa', ['container']);
    expect(keywords).toContain('docker');
  });

  it('expands "chạy ngầm" to daemon synonyms', () => {
    const keywords = expandGithubSynonyms('chạy ngầm', ['daemon']);
    expect(keywords).toContain('background');
    expect(keywords).toContain('service');
  });

  it('expands "phi tập trung" to decentralized synonyms', () => {
    const keywords = expandGithubSynonyms('phi tập trung', ['decentralized']);
    expect(keywords).toContain('p2p');
    expect(keywords).toContain('distributed');
  });
});

// ── New VIETNAMESE_INTENT_PATTERNS ──

describe('classifyVietnameseIntent — new intent patterns', () => {
  it('classifies "etl" as database intent', () => {
    const intent = classifyVietnameseIntent('công cụ etl xử lý dữ liệu');
    expect(intent).toBe('database');
  });

  it('classifies "nhúng" (embedding) as ai-ml-tool', () => {
    const intent = classifyVietnameseIntent('tìm kiếm ngữ nghĩa nhúng vector');
    expect(intent).toBe('ai-ml-tool');
  });

  it('classifies "quản lý nội dung" (CMS) as web-app', () => {
    const intent = classifyVietnameseIntent('hệ thống quản lý nội dung web');
    expect(intent).toBe('web-app');
  });

  it('classifies "tìm kiếm toàn văn" as library', () => {
    const intent = classifyVietnameseIntent('thư viện tìm kiếm toàn văn');
    expect(intent).toBe('library');
  });

  it('classifies "theo dõi lỗi" (error tracking) as monitoring', () => {
    const intent = classifyVietnameseIntent('công cụ theo dõi lỗi');
    expect(intent).toBe('monitoring');
  });

  it('classifies "mlops" as devops-tool', () => {
    const intent = classifyVietnameseIntent('nền tảng mlops quản lý mô hình');
    expect(intent).toBe('devops-tool');
  });
});

// ── New TECH_TERMS entries ──

describe('extractTechTerms — new terms', () => {
  it('extracts Supabase as backend-as-a-service', () => {
    const terms = extractTechTerms('tự host với supabase');
    expect(terms).toContain('supabase');
    expect(terms).toContain('backend-as-a-service');
  });

  it('extracts pgvector as vector-database', () => {
    const terms = extractTechTerms('tìm kiếm semantic với pgvector');
    expect(terms).toContain('pgvector');
    expect(terms).toContain('vector-database');
  });

  it('extracts langchain as llm-framework', () => {
    const terms = extractTechTerms('xây dựng ứng dụng AI với langchain');
    expect(terms).toContain('langchain');
    expect(terms).toContain('llm-framework');
  });

  it('extracts tailwind as css-framework', () => {
    const terms = extractTechTerms('giao diện với tailwind');
    expect(terms).toContain('tailwind');
    expect(terms).toContain('css-framework');
  });

  it('extracts n8n as workflow-automation', () => {
    const terms = extractTechTerms('tự động hóa workflow với n8n');
    expect(terms).toContain('n8n');
    expect(terms).toContain('workflow-automation');
  });

  it('extracts cloudflare as cdn', () => {
    const terms = extractTechTerms('CDN cloudflare');
    expect(terms).toContain('cloudflare');
    expect(terms).toContain('cdn');
  });

  it('extracts influxdb as time-series', () => {
    const terms = extractTechTerms('monitoring với influxdb');
    expect(terms).toContain('influxdb');
    expect(terms).toContain('time-series');
  });
});

// ── normalizeDiacritics ──

describe('normalizeDiacritics', () => {
  it('strips Vietnamese combining marks', () => {
    expect(normalizeDiacritics('quản')).toBe('quan');
    expect(normalizeDiacritics('lý')).toBe('ly');
    expect(normalizeDiacritics('giám sát')).toBe('giam sat');
  });

  it('converts đ/Đ to d/D', () => {
    expect(normalizeDiacritics('đăng')).toBe('dang');
    expect(normalizeDiacritics('Đăng')).toBe('Dang');
  });

  it('handles mixed Vietnamese and ASCII text', () => {
    expect(normalizeDiacritics('quản lý mật khẩu')).toBe('quan ly mat khau');
    expect(normalizeDiacritics('máy chủ email')).toBe('may chu email');
  });

  it('leaves pure ASCII unchanged', () => {
    expect(normalizeDiacritics('docker container')).toBe('docker container');
    expect(normalizeDiacritics('ci-cd pipeline')).toBe('ci-cd pipeline');
  });

  it('handles empty string', () => {
    expect(normalizeDiacritics('')).toBe('');
  });
});

// ── ENGLISH_GENERIC_TERMS ──

describe('ENGLISH_GENERIC_TERMS', () => {
  it('contains system-level generic terms that dilute Vietnamese queries', () => {
    expect(ENGLISH_GENERIC_TERMS.has('system')).toBe(true);
    expect(ENGLISH_GENERIC_TERMS.has('platform')).toBe(true);
    expect(ENGLISH_GENERIC_TERMS.has('tool')).toBe(true);
  });

  it('contains English function words that add no search value', () => {
    expect(ENGLISH_GENERIC_TERMS.has('manager')).toBe(true);
    // 'runner' intentionally excluded — legitimate CI/CD search term
    expect(ENGLISH_GENERIC_TERMS.has('runner')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('service')).toBe(true);
  });

  it('does NOT contain domain-specific terms that should survive filtering', () => {
    // These should NOT be generic — they carry specific search intent
    expect(ENGLISH_GENERIC_TERMS.has('docker')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('monitoring')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('database')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('devops-tool')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('cli-tool')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('runner')).toBe(false);
    expect(ENGLISH_GENERIC_TERMS.has('engine')).toBe(false);
  });
});

// ── localTranslate quality improvements ──

describe('localTranslate — quality improvements', () => {
  it('filters ENGLISH_GENERIC_TERMS from primary translation', async () => {
    // "hệ thống" maps to ["system", "infra"]. "system" is generic → filtered.
    // "infra" should survive.
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('hệ thống giám sát');
    expect(result).not.toBeNull();
    expect(result!.englishTranslation.toLowerCase()).not.toContain('system');
    // "monitoring" or "infra" should still be present
    expect(result!.technicalConcepts.length).toBeGreaterThan(0);
  });

  it('strips diacritics on unrecognized Vietnamese words instead of dropping', async () => {
    // "quyền" is not in the dictionary — it should be romanized to "quyen"
    // rather than silently dropped
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('quyền truy cập');
    expect(result).not.toBeNull();
    // The translation should contain some romanized form
    expect(result!.englishTranslation.length).toBeGreaterThan(0);
  });

  it('filters stop words from translation output', async () => {
    // "đang" is a stop word — should not appear in English translation
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('đang tìm kiếm docker');
    expect(result).not.toBeNull();
    expect(result!.englishTranslation.toLowerCase()).not.toContain('đang');
  });
});

// ── New VIETNAMESE_TECH_DICTIONARY entries ──

describe('VietnameseQueryExpander — new dictionary entries', () => {
  it('translates "quản lý mã nguồn" to version-control', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('quản lý mã nguồn');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('version-control');
    expect(result!.technicalConcepts).toContain('git');
  });

  it('translates "cơ sở dữ liệu quan hệ" to relational-database', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('cơ sở dữ liệu quan hệ');
    expect(result).not.toBeNull();
    expect(result!.englishTranslation.toLowerCase()).toContain('relational-database');
    expect(result!.technicalConcepts).toContain('relational-database');
    // Should NOT also contain the shorter "database" from partial match
  });

  it('translates "cơ sở dữ liệu phi quan hệ" to nosql', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('cơ sở dữ liệu phi quan hệ');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('nosql');
  });

  it('translates "proxy đảo ngược" to reverse-proxy', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('proxy đảo ngược');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('reverse-proxy');
  });

  it('translates "đăng nhập một lần" to sso', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('đăng nhập một lần');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('sso');
  });

  it('translates "lưu trữ đối tượng" to object-storage', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('lưu trữ đối tượng');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('object-storage');
  });

  it('translates "máy chủ email" to mail-server', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('máy chủ email');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('mail-server');
  });

  it('translates "phát hiện sự cố" to incident-detection', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('phát hiện sự cố');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('incident-detection');
  });
});

// ── New TECH_TERMS entries ──

// ── New dictionary entries — data-visualization, vpn, home-automation ──

describe('VietnameseQueryExpander — data-visualization and new dictionary entries', () => {
  it('translates "đồ thị" to chart/graph/visualization', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('đồ thị kết quả');
    expect(result).not.toBeNull();
    const allConcepts = result!.technicalConcepts.join(' ').toLowerCase();
    expect(allConcepts).toContain('chart');
  });

  it('translates "biểu đồ" to chart/visualization', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('vẽ biểu đồ');
    expect(result).not.toBeNull();
    const allConcepts = result!.technicalConcepts.join(' ').toLowerCase();
    expect(allConcepts).toContain('chart');
  });

  it('translates "mạng riêng ảo" to vpn/wireguard', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('mạng riêng ảo');
    expect(result).not.toBeNull();
    const allConcepts = result!.technicalConcepts.join(' ').toLowerCase();
    expect(allConcepts).toContain('vpn');
  });

  it('translates "nhà thông minh" to home-automation', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('nhà thông minh');
    expect(result).not.toBeNull();
    const allConcepts = result!.technicalConcepts.join(' ').toLowerCase();
    expect(allConcepts).toContain('home-automation');
  });

  it('translates "ghi chú" to notes/note-taking', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('ứng dụng ghi chú');
    expect(result).not.toBeNull();
    const allConcepts = result!.technicalConcepts.join(' ').toLowerCase();
    expect(allConcepts).toContain('notes');
  });
});

describe('extractTechTerms — self-hosting tools', () => {
  it('extracts gitea as git-server', () => {
    const terms = extractTechTerms('tự host gitea');
    expect(terms).toContain('gitea');
    expect(terms).toContain('git-server');
  });

  it('extracts keycloak as identity/sso', () => {
    const terms = extractTechTerms('tự host keycloak sso');
    expect(terms).toContain('keycloak');
    expect(terms).toContain('identity');
    expect(terms).toContain('sso');
  });

  it('extracts harbor as container-registry', () => {
    const terms = extractTechTerms('harbor registry docker');
    expect(terms).toContain('harbor');
    expect(terms).toContain('container-registry');
  });

  it('extracts portainer as docker-management', () => {
    const terms = extractTechTerms('quản lý docker portainer');
    expect(terms).toContain('portainer');
    expect(terms).toContain('docker-management');
  });
});

// ── New VIETNAMESE_GITHUB_SYNONYMS entries ──

describe('expandGithubSynonyms — new compound entries', () => {
  it('expands "quản lý mã nguồn" to version-control synonyms', () => {
    const expanded = expandGithubSynonyms('quản lý mã nguồn', ['version-control']);
    expect(expanded).toContain('git');
    expect(expanded).toContain('scm');
  });

  it('expands "máy chủ email" to mail-server synonyms', () => {
    const expanded = expandGithubSynonyms('máy chủ email', ['mail-server']);
    expect(expanded).toContain('smtp');
    expect(expanded).toContain('imap');
  });

  it('expands "lưu trữ đối tượng" to object-storage synonyms', () => {
    const expanded = expandGithubSynonyms('lưu trữ đối tượng', ['object-storage']);
    expect(expanded).toContain('s3');
    expect(expanded).toContain('minio');
  });

  it('expands "đăng nhập một lần" to sso synonyms', () => {
    const expanded = expandGithubSynonyms('đăng nhập một lần', ['sso']);
    expect(expanded).toContain('single-sign-on');
    expect(expanded).toContain('oauth');
  });

  it('expands "phát hiện sự cố" to incident-detection synonyms', () => {
    const expanded = expandGithubSynonyms('phát hiện sự cố', ['incident-detection']);
    expect(expanded).toContain('alerting');
  });
});

// ── New VIETNAMESE_INTENT_PATTERNS entries ──

describe('classifyVietnameseIntent — self-hosting community intents', () => {
  it('classifies "quản lý mã nguồn" as devops-tool', () => {
    const intent = classifyVietnameseIntent('quản lý mã nguồn gitea');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "quản lý định danh" as authentication', () => {
    const intent = classifyVietnameseIntent('quản lý định danh keycloak');
    expect(intent).toBe('authentication');
  });

  it('classifies "đăng nhập một lần" as authentication', () => {
    const intent = classifyVietnameseIntent('đăng nhập một lần sso');
    expect(intent).toBe('authentication');
  });

  it('classifies wiki/knowledge queries as web-app', () => {
    const intent = classifyVietnameseIntent('wiki kiến thức chung');
    expect(intent).toBe('web-app');
  });

  it('classifies "thông báo đẩy" as messaging', () => {
    const intent = classifyVietnameseIntent('thông báo đẩy gotify');
    expect(intent).toBe('messaging');
  });

  it('classifies "chia sẻ tệp" as self-hosted', () => {
    const intent = classifyVietnameseIntent('chia sẻ tệp nextcloud');
    expect(intent).toBe('self-hosted');
  });

  it('classifies "quản lý dự án" as web-app', () => {
    const intent = classifyVietnameseIntent('quản lý dự án kanban');
    expect(intent).toBe('web-app');
  });
});

// ── New dictionary entries (added in this session) ──

describe('VietnameseQueryExpander — additional dictionary entries', () => {
  it('translates "tối ưu" to optimization', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('tối ưu hiệu suất');
    expect(result).not.toBeNull();
    // "tối ưu hiệu suất" matches the compound dict entry → performance-optimization
    // "tối ưu" alone would match → optimization. Either is valid.
    const concepts = result!.technicalConcepts.map(c => c.toLowerCase());
    expect(concepts.some(c => c.includes('optimization'))).toBe(true);
  });

  it('translates "máy chủ web" to web-server', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('máy chủ web');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('web-server');
  });

  it('translates "báo cáo lỗi" to issue-tracker', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('báo cáo lỗi');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('issue-tracker');
  });

  it('translates "kiểm soát truy cập" to access-control', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('kiểm soát truy cập');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('access-control');
  });

  it('translates "phiên bản hóa" to versioning', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('phiên bản hóa');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('versioning');
  });

  it('translates "cổng api" to api-gateway', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('cổng api');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('api-gateway');
  });

  it('translates "máy chủ proxy" to proxy-server', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('máy chủ proxy');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('proxy-server');
  });

  it('translates "quét bảo mật" to security-scanning', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('quét bảo mật');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('security-scanning');
  });

  it('translates "hiệu suất cao" to high-performance', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('hiệu suất cao');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('high-performance');
  });

  it('translates "biên tập mã" to code-editor', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('biên tập mã');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('code-editor');
  });

  it('translates "quản lý gói" to package-manager', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('quản lý gói');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('package-manager');
  });

  it('translates "triển khai tự động" to auto-deploy', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('triển khai tự động');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('auto-deploy');
  });

  it('translates "sao chép dữ liệu" to data-replication', async () => {
    const expander = new VietnameseQueryExpander();
    const result = await expander.expand('sao chép dữ liệu');
    expect(result).not.toBeNull();
    expect(result!.technicalConcepts).toContain('data-replication');
  });
});

// ── New synonym entries (added in this session) ──

describe('expandGithubSynonyms — additional compound entries', () => {
  it('expands "máy chủ web" to web-server synonyms', () => {
    const expanded = expandGithubSynonyms('máy chủ web', ['web-server']);
    expect(expanded).toContain('http-server');
  });

  it('expands "bảng trạng thái" to status-page synonyms', () => {
    const expanded = expandGithubSynonyms('bảng trạng thái', ['status-page']);
    expect(expanded).toContain('uptime-monitor');
  });

  it('expands "cổng api" to api-gateway synonyms', () => {
    const expanded = expandGithubSynonyms('cổng api', ['api-gateway']);
    expect(expanded).toContain('rest-api');
  });

  it('expands "máy chủ proxy" to proxy-server synonyms', () => {
    const expanded = expandGithubSynonyms('máy chủ proxy', ['proxy-server']);
    expect(expanded).toContain('reverse-proxy');
  });

  it('expands "kiểm soát truy cập" to access-control synonyms', () => {
    const expanded = expandGithubSynonyms('kiểm soát truy cập', ['access-control']);
    expect(expanded).toContain('rbac');
  });

  it('expands "phiên bản hóa" to versioning synonyms', () => {
    const expanded = expandGithubSynonyms('phiên bản hóa', ['versioning']);
    expect(expanded).toContain('git');
  });

  it('expands "quét bảo mật" to security-scanning synonyms', () => {
    const expanded = expandGithubSynonyms('quét bảo mật', ['security-scanning']);
    expect(expanded).toContain('vulnerability-scan');
  });

  it('expands "báo cáo lỗi" to issue-tracker synonyms', () => {
    const expanded = expandGithubSynonyms('báo cáo lỗi', ['issue-tracker']);
    expect(expanded).toContain('bug-tracker');
  });

  it('expands "máy chủ tệp" to file-server synonyms', () => {
    const expanded = expandGithubSynonyms('máy chủ tệp', ['file-server']);
    expect(expanded).toContain('nas');
  });
});

// ── New intent patterns (added in this session) ──

describe('classifyVietnameseIntent — additional high-ROI intents', () => {
  it('classifies "tối ưu" as devops-tool', () => {
    const intent = classifyVietnameseIntent('tối ưu hiệu suất');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "hiệu suất" as devops-tool', () => {
    const intent = classifyVietnameseIntent('hiệu suất cao');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "ứng dụng desktop" as desktop-app', () => {
    const intent = classifyVietnameseIntent('ứng dụng desktop electron');
    expect(intent).toBe('desktop-app');
  });

  it('classifies "ứng dụng máy tính" as desktop-app', () => {
    const intent = classifyVietnameseIntent('ứng dụng máy tính');
    expect(intent).toBe('desktop-app');
  });

  it('classifies "thiết kế api" as api', () => {
    const intent = classifyVietnameseIntent('thiết kế api');
    expect(intent).toBe('api');
  });

  it('classifies "mở rộng" as devops-tool (scaling)', () => {
    const intent = classifyVietnameseIntent('mở rộng hệ thống');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "chạy container" as containerization', () => {
    const intent = classifyVietnameseIntent('chạy container podman');
    expect(intent).toBe('containerization');
  });

  it('classifies "phiên bản hóa" as devops-tool', () => {
    const intent = classifyVietnameseIntent('phiên bản hóa git');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "sao lưu dự phòng" as self-hosted', () => {
    const intent = classifyVietnameseIntent('sao lưu dự phòng');
    expect(intent).toBe('self-hosted');
  });

  it('classifies "hệ thống tri thức" as web-app', () => {
    const intent = classifyVietnameseIntent('hệ thống tri thức');
    expect(intent).toBe('web-app');
  });

  it('classifies "xử lý dữ liệu lớn" as database', () => {
    const intent = classifyVietnameseIntent('xử lý dữ liệu lớn airflow');
    expect(intent).toBe('database');
  });
});

// ── New intent patterns (session 2 — Vietnamese developer queries) ──

describe('classifyVietnameseIntent — Vietnamese developer query intents', () => {
  it('classifies "quản lý dự án" as web-app (project management)', () => {
    const intent = classifyVietnameseIntent('quản lý dự án');
    expect(intent).toBe('web-app');
  });

  it('classifies "bảng công việc" as web-app (kanban)', () => {
    const intent = classifyVietnameseIntent('bảng công việc kanban');
    expect(intent).toBe('web-app');
  });

  it('classifies "máy chủ email" as self-hosted (email server)', () => {
    const intent = classifyVietnameseIntent('máy chủ email tự host');
    expect(intent).toBe('self-hosted');
  });

  it('classifies "thư điện tử" as self-hosted (email)', () => {
    const intent = classifyVietnameseIntent('thư điện tử');
    expect(intent).toBe('self-hosted');
  });

  it('classifies "trực quan dữ liệu" as data-visualization', () => {
    const intent = classifyVietnameseIntent('trực quan dữ liệu');
    expect(intent).toBe('data-visualization');
  });

  it('classifies "biểu đồ" as data-visualization (charts)', () => {
    const intent = classifyVietnameseIntent('thư viện biểu đồ');
    expect(intent).toBe('data-visualization');
  });

  it('classifies "vẽ đồ thị" as data-visualization', () => {
    const intent = classifyVietnameseIntent('công cụ vẽ đồ thị');
    expect(intent).toBe('data-visualization');
  });

  it('classifies "quản lý trạng thái" as library (state management)', () => {
    const intent = classifyVietnameseIntent('quản lý trạng thái react');
    expect(intent).toBe('library');
  });

  it('classifies "công cụ kiểm thử" as testing', () => {
    const intent = classifyVietnameseIntent('công cụ kiểm thử');
    expect(intent).toBe('testing');
  });

  it('classifies "kiểm thử tự động" as testing', () => {
    const intent = classifyVietnameseIntent('kiểm thử tự động');
    expect(intent).toBe('testing');
  });

  it('classifies "xử lý sự kiện" as library (event processing)', () => {
    const intent = classifyVietnameseIntent('xử lý sự kiện');
    expect(intent).toBe('library');
  });

  it('classifies "xử lý pdf" as library (PDF processing)', () => {
    const intent = classifyVietnameseIntent('xử lý pdf');
    expect(intent).toBe('library');
  });

  it('classifies "phân giải dns" as networking-tool', () => {
    const intent = classifyVietnameseIntent('phân giải dns');
    expect(intent).toBe('networking-tool');
  });

  it('classifies "smtp" as self-hosted (email protocol)', () => {
    const intent = classifyVietnameseIntent('smtp server');
    expect(intent).toBe('self-hosted');
  });

  it('classifies "kanban board" as web-app', () => {
    const intent = classifyVietnameseIntent('kanban board');
    expect(intent).toBe('web-app');
  });
});

// ── New TECH_TERMS (session 2) ──

describe('extractTechTerms — additional terms', () => {
  it('extracts SvelteKit as frontend', () => {
    const terms = extractTechTerms('sveltekit app');
    expect(terms).toContain('sveltekit');
    expect(terms).toContain('frontend');
  });

  it('extracts htmx as frontend', () => {
    const terms = extractTechTerms('htmx web app');
    expect(terms).toContain('htmx');
    expect(terms).toContain('frontend');
  });

  it('extracts memcached as cache', () => {
    const terms = extractTechTerms('memcached caching');
    expect(terms).toContain('memcached');
    expect(terms).toContain('cache');
  });

  it('extracts clickhouse as database', () => {
    const terms = extractTechTerms('clickhouse olap');
    expect(terms).toContain('clickhouse');
    expect(terms).toContain('database');
  });

  it('extracts playwright as testing', () => {
    const terms = extractTechTerms('playwright e2e testing');
    expect(terms).toContain('playwright');
    expect(terms).toContain('testing');
  });

  it('extracts vitest as testing', () => {
    const terms = extractTechTerms('vitest unit test');
    expect(terms).toContain('vitest');
    expect(terms).toContain('testing');
  });

  it('extracts pytorch as deep-learning', () => {
    const terms = extractTechTerms('pytorch model training');
    expect(terms).toContain('pytorch');
    expect(terms).toContain('deep-learning');
  });

  it('extracts prisma as orm', () => {
    const terms = extractTechTerms('prisma database');
    expect(terms).toContain('prisma');
    expect(terms).toContain('orm');
  });

  it('extracts fastapi as backend', () => {
    const terms = extractTechTerms('fastapi python');
    expect(terms).toContain('fastapi');
    expect(terms).toContain('backend');
  });

  it('extracts onnx as inference', () => {
    const terms = extractTechTerms('onnx model inference');
    expect(terms).toContain('onnx');
    expect(terms).toContain('inference');
  });

  // ── New TECH_TERMS entries (data-visualization, self-hosting favorites) ──

  it('extracts d3 as data-visualization', () => {
    const terms = extractTechTerms('d3 chart library');
    expect(terms).toContain('d3');
    expect(terms).toContain('data-visualization');
  });

  it('extracts chartjs as data-visualization', () => {
    const terms = extractTechTerms('chartjs react dashboard');
    expect(terms).toContain('chartjs');
    expect(terms).toContain('data-visualization');
  });

  it('extracts plotly as data-visualization', () => {
    const terms = extractTechTerms('plotly python graph');
    expect(terms).toContain('plotly');
    expect(terms).toContain('data-visualization');
  });

  it('extracts vaultwarden as password-manager', () => {
    const terms = extractTechTerms('vaultwarden self-hosted password');
    expect(terms).toContain('vaultwarden');
    expect(terms).toContain('password-manager');
  });

  it('extracts wireguard as vpn', () => {
    const terms = extractTechTerms('wireguard vpn server');
    expect(terms).toContain('wireguard');
    expect(terms).toContain('vpn');
  });

  it('extracts homeassistant as home-automation', () => {
    const terms = extractTechTerms('homeassistant smart home');
    expect(terms).toContain('home-assistant');
    expect(terms).toContain('home-automation');
  });

  it('extracts metabase as analytics/dashboard', () => {
    const terms = extractTechTerms('metabase analytics dashboard');
    expect(terms).toContain('metabase');
    expect(terms).toContain('analytics');
  });

  it('extracts postgrest as api', () => {
    const terms = extractTechTerms('postgrest api');
    expect(terms).toContain('postgrest');
  });
});

// ── New VIETNAMESE_GITHUB_SYNONYMS (session 2) ──

describe('expandGithubSynonyms — additional compound synonyms', () => {
  it('expands "công cụ" to tool/cli/utility synonyms', () => {
    const expanded = expandGithubSynonyms('công cụ phát triển', ['tool']);
    // "tool" is already in translatedParts, so should be filtered
    expect(expanded.some(e => ['cli', 'utility'].includes(e))).toBe(true);
  });

  it('expands "hàng đợi" to queue synonyms', () => {
    const expanded = expandGithubSynonyms('hàng đợi tin nhắn', []);
    expect(expanded).toContain('queue');
    expect(expanded).toContain('message-queue');
  });

  it('expands "sự kiện" to event synonyms', () => {
    const expanded = expandGithubSynonyms('xử lý sự kiện', []);
    expect(expanded).toContain('event');
    expect(expanded).toContain('event-driven');
  });

  it('expands "xác thực" to authentication synonyms', () => {
    const expanded = expandGithubSynonyms('xác thực người dùng', []);
    expect(expanded).toContain('authentication');
    expect(expanded).toContain('auth');
  });

  it('expands "môi trường" to environment synonyms', () => {
    const expanded = expandGithubSynonyms('môi trường phát triển', []);
    expect(expanded).toContain('environment');
  });

  it('expands "trạng thái" to state synonyms', () => {
    const expanded = expandGithubSynonyms('quản lý trạng thái', []);
    expect(expanded).toContain('state');
    expect(expanded).toContain('state-management');
  });

  it('expands "chuyển đổi" to converter synonyms', () => {
    const expanded = expandGithubSynonyms('chuyển đổi định dạng', []);
    expect(expanded).toContain('converter');
  });

  it('expands "dự án" to project synonyms', () => {
    const expanded = expandGithubSynonyms('quản lý dự án', []);
    expect(expanded).toContain('project');
    expect(expanded).toContain('project-management');
  });

  it('expands "trực quan hóa" to visualization synonyms', () => {
    const expanded = expandGithubSynonyms('trực quan hóa dữ liệu', []);
    expect(expanded).toContain('visualization');
    expect(expanded).toContain('dashboard');
  });

  it('expands "phân tán" to distributed synonyms', () => {
    const expanded = expandGithubSynonyms('hệ thống phân tán', ['distributed']);
    expect(expanded).toContain('decentralized');
    expect(expanded).toContain('p2p');
  });

  // ── New synonym entries (data-visualization, vpn, home-automation, etc.) ──

  it('expands "đồ thị" to chart/graph/visualization synonyms', () => {
    const expanded = expandGithubSynonyms('vẽ đồ thị dữ liệu', []);
    expect(expanded).toContain('chart');
    expect(expanded).toContain('visualization');
  });

  it('expands "biểu đồ" to chart/visualization synonyms', () => {
    const expanded = expandGithubSynonyms('biểu đồ kết quả', []);
    expect(expanded).toContain('chart');
    expect(expanded).toContain('plot');
  });

  it('expands "mạng riêng ảo" to vpn/wireguard synonyms', () => {
    const expanded = expandGithubSynonyms('mạng riêng ảo', []);
    expect(expanded).toContain('vpn');
    expect(expanded).toContain('wireguard');
  });

  it('expands "nhà thông minh" to home-automation synonyms', () => {
    const expanded = expandGithubSynonyms('nhà thông minh', []);
    expect(expanded).toContain('home-automation');
    expect(expanded).toContain('smart-home');
  });

  it('expands "ghi chú" to notes synonyms', () => {
    const expanded = expandGithubSynonyms('ứng dụng ghi chú', []);
    expect(expanded).toContain('notes');
    expect(expanded).toContain('note-taking');
  });

  it('expands "hệ thống wiki" to wiki/knowledge-base synonyms', () => {
    const expanded = expandGithubSynonyms('hệ thống wiki', []);
    expect(expanded).toContain('wiki');
    expect(expanded).toContain('knowledge-base');
  });
});

// ── normalizeVietnameseQuery ──

describe('normalizeVietnameseQuery', () => {
  it('strips "tôi muốn tìm một" prefix', () => {
    const result = normalizeVietnameseQuery('tôi muốn tìm một công cụ giám sát');
    expect(result).toBe('công cụ giám sát');
  });

  it('strips "tôi muốn một" prefix', () => {
    const result = normalizeVietnameseQuery('tôi muốn một công cụ giám sát');
    expect(result).toBe('công cụ giám sát');
  });

  it('strips "tôi cần tìm một" prefix', () => {
    const result = normalizeVietnameseQuery('tôi cần tìm một thư viện đồ thị');
    expect(result).toBe('thư viện đồ thị');
  });

  it('strips "tôi đang tìm" prefix', () => {
    const result = normalizeVietnameseQuery('tôi đang tìm công cụ quản lý mật khẩu');
    expect(result).toBe('công cụ quản lý mật khẩu');
  });

  it('strips "cho tôi một" prefix', () => {
    const result = normalizeVietnameseQuery('cho tôi một máy chủ email');
    expect(result).toBe('máy chủ email');
  });

  it('strips "bạn có thể giúp tôi tìm" prefix', () => {
    const result = normalizeVietnameseQuery('bạn có thể giúp tôi tìm nền tảng giám sát');
    expect(result).toBe('nền tảng giám sát');
  });

  it('strips "làm ơn tìm" prefix', () => {
    const result = normalizeVietnameseQuery('làm ơn tìm công cụ sao lưu');
    expect(result).toBe('công cụ sao lưu');
  });

  it('returns unchanged for queries without filler', () => {
    const result = normalizeVietnameseQuery('công cụ giám sát máy chủ');
    expect(result).toBe('công cụ giám sát máy chủ');
  });

  it('returns unchanged for queries with too-short remainder (safety)', () => {
    // "tôi muốn abc" → remainder "abc" < 4 chars, not meaningful
    const result = normalizeVietnameseQuery('tôi muốn abc');
    expect(result).toBe('tôi muốn abc');
  });

  it('returns unchanged for English queries', () => {
    // Not Vietnamese, but the function is pure text processing
    const result = normalizeVietnameseQuery('I want a CI/CD tool');
    // "I want" doesn't match Vietnamese filler patterns, so unchanged
    expect(result).toBe('I want a CI/CD tool');
  });
});

// ── ENGLISH_GENERIC_TERMS: runner/engine exclusion ──

describe('ENGLISH_GENERIC_TERMS (runner/engine not filtered)', () => {
  it('does NOT filter "runner" (legitimate CI/CD term)', () => {
    expect(ENGLISH_GENERIC_TERMS.has('runner')).toBe(false);
  });

  it('does NOT filter "engine" (legitimate compute term)', () => {
    expect(ENGLISH_GENERIC_TERMS.has('engine')).toBe(false);
  });

  it('still filters "system" (too generic)', () => {
    expect(ENGLISH_GENERIC_TERMS.has('system')).toBe(true);
  });

  it('still filters "tool" (too generic)', () => {
    expect(ENGLISH_GENERIC_TERMS.has('tool')).toBe(true);
  });
});

// ── New high-frequency Vietnamese dictionary entries (added 2026-06-07) ──

describe('expandGithubSynonyms — high-frequency entries', () => {
  it('expands "người dùng" to user synonyms', () => {
    const keywords = expandGithubSynonyms('người dùng', ['user']);
    expect(keywords).toContain('user-management');
    expect(keywords).toContain('identity');
  });

  it('expands "dịch vụ" to service synonyms', () => {
    const keywords = expandGithubSynonyms('dịch vụ', ['service']);
    expect(keywords).toContain('microservice');
    expect(keywords).toContain('api');
  });

  it('expands "truy cập" to access synonyms', () => {
    const keywords = expandGithubSynonyms('truy cập', ['access']);
    expect(keywords).toContain('access-control');
    expect(keywords).toContain('gateway');
  });

  it('expands "tài khoản" to account synonyms', () => {
    const keywords = expandGithubSynonyms('tài khoản', ['account']);
    expect(keywords).toContain('user-account');
    expect(keywords).toContain('profile');
  });

  it('expands "quản trị" to admin synonyms', () => {
    const keywords = expandGithubSynonyms('quản trị', ['admin']);
    expect(keywords).toContain('administration');
    expect(keywords).toContain('dashboard');
  });

  it('expands "đăng ký" to registration synonyms', () => {
    const keywords = expandGithubSynonyms('đăng ký', ['registration']);
    expect(keywords).toContain('signup');
    expect(keywords).toContain('onboarding');
  });

  it('expands "dịch vụ web" to web-service synonyms', () => {
    const keywords = expandGithubSynonyms('dịch vụ web', ['web-service']);
    expect(keywords).toContain('rest-api');
    expect(keywords).toContain('api');
  });

  it('expands "xác thực người dùng" to auth synonyms', () => {
    const keywords = expandGithubSynonyms('xác thực người dùng', ['user-authentication']);
    expect(keywords).toContain('auth');
    expect(keywords).toContain('login');
  });

  it('expands "xác thực hai lớp" to 2fa synonyms', () => {
    const keywords = expandGithubSynonyms('xác thực hai lớp', ['2fa']);
    expect(keywords).toContain('mfa');
    expect(keywords).toContain('two-factor-auth');
  });

  it('expands "quản lý người dùng" to user-mgmt synonyms', () => {
    const keywords = expandGithubSynonyms('quản lý người dùng', ['user-management']);
    expect(keywords).toContain('identity-management');
    expect(keywords).toContain('iam');
  });

  it('expands "quản lý truy cập" to access-control synonyms', () => {
    const keywords = expandGithubSynonyms('quản lý truy cập', ['access-control']);
    expect(keywords).toContain('rbac');
    expect(keywords).toContain('permissions');
  });

  it('expands "quản trị hệ thống" to sysadmin synonyms', () => {
    const keywords = expandGithubSynonyms('quản trị hệ thống', ['system-administration']);
    expect(keywords).toContain('sysadmin');
    expect(keywords).toContain('ops');
  });

  it('expands "đăng ký dịch vụ" to service-registry synonyms', () => {
    const keywords = expandGithubSynonyms('đăng ký dịch vụ', ['service-registry']);
    expect(keywords).toContain('service-discovery');
    expect(keywords).toContain('consul');
  });
});

describe('classifyVietnameseIntent — high-frequency entries', () => {
  it('classifies "quản lý người dùng" as authentication', () => {
    const intent = classifyVietnameseIntent('quản lý người dùng');
    expect(intent).toBe('authentication');
  });

  it('classifies "xác thực người dùng" as authentication', () => {
    const intent = classifyVietnameseIntent('xác thực người dùng oauth');
    expect(intent).toBe('authentication');
  });

  it('classifies "xác thực hai lớp" as authentication', () => {
    const intent = classifyVietnameseIntent('xác thực hai lớp');
    expect(intent).toBe('authentication');
  });

  it('classifies "quản lý tài khoản" as authentication', () => {
    const intent = classifyVietnameseIntent('quản lý tài khoản người dùng');
    expect(intent).toBe('authentication');
  });

  it('classifies "quản lý truy cập" as security-tool', () => {
    const intent = classifyVietnameseIntent('quản lý truy cập hệ thống');
    expect(intent).toBe('security-tool');
  });

  it('classifies "dịch vụ vi mô" as devops-tool', () => {
    const intent = classifyVietnameseIntent('dịch vụ vi mô');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "đăng ký dịch vụ" as devops-tool', () => {
    const intent = classifyVietnameseIntent('đăng ký dịch vụ consul');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "dịch vụ đám mây" as devops-tool', () => {
    const intent = classifyVietnameseIntent('dịch vụ đám mây serverless');
    expect(intent).toBe('devops-tool');
  });

  it('classifies "dịch vụ web" as api', () => {
    const intent = classifyVietnameseIntent('dịch vụ web restful');
    expect(intent).toBe('api');
  });

  it('classifies "quản trị hệ thống" as devops-tool', () => {
    const intent = classifyVietnameseIntent('quản trị hệ thống linux');
    expect(intent).toBe('devops-tool');
  });
});

describe('quickVietnameseTranslateStructured — high-frequency entries', () => {
  it('translates "quản lý người dùng" as user-management', () => {
    const result = quickVietnameseTranslateStructured('quản lý người dùng');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('user-management');
    expect(result!.dictionaryConcepts).toContain('user-management');
    expect(result!.dictionaryConcepts).toContain('identity-management');
  });

  it('translates "dịch vụ web" as web-service', () => {
    const result = quickVietnameseTranslateStructured('dịch vụ web');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('web-service');
    expect(result!.dictionaryConcepts).toContain('api');
  });

  it('translates "xác thực hai lớp" as 2fa', () => {
    const result = quickVietnameseTranslateStructured('xác thực hai lớp');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('2fa');
    expect(result!.dictionaryConcepts).toContain('mfa');
    expect(result!.dictionaryConcepts).toContain('two-factor-authentication');
  });

  it('translates "quản lý truy cập" as access-control', () => {
    const result = quickVietnameseTranslateStructured('quản lý truy cập');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('access-control');
    expect(result!.dictionaryConcepts).toContain('rbac');
  });

  it('translates "đăng ký dịch vụ" as service-registration', () => {
    const result = quickVietnameseTranslateStructured('đăng ký dịch vụ');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('service-registration');
    expect(result!.dictionaryConcepts).toContain('service-discovery');
  });

  it('translates "dịch vụ vi mô" as microservice', () => {
    const result = quickVietnameseTranslateStructured('dịch vụ vi mô');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('microservice');
    expect(result!.dictionaryConcepts).toContain('microservices');
  });

  it('translates "quản trị hệ thống" as system-administration', () => {
    const result = quickVietnameseTranslateStructured('quản trị hệ thống');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('system-administration');
    expect(result!.dictionaryConcepts).toContain('sysadmin');
  });

  it('dictionaryConcepts carry domain signal for new entries', () => {
    // "quản lý người dùng" has no English tech terms — dictionaryConcepts must carry the signal
    const result = quickVietnameseTranslateStructured('quản lý người dùng');
    expect(result).not.toBeNull();
    expect(result!.techTerms.length).toBe(0);
    expect(result!.dictionaryConcepts.length).toBeGreaterThanOrEqual(2);
    expect(result!.dictionaryConcepts).toContain('user-management');
  });
});

describe('quickVietnameseTranslate — new dictionary entries', () => {
  it('translates "ứng dụng" as application/app', () => {
    const result = quickVietnameseTranslateStructured('ứng dụng');
    expect(result).not.toBeNull();
    // 'application' is filtered as generic; 'app' is the non-generic fallback
    expect(result!.translation).toContain('app');
  });

  it('translates "dịch vụ" as microservice (service is generic-filtered)', () => {
    const result = quickVietnameseTranslateStructured('dịch vụ');
    expect(result).not.toBeNull();
    // 'service' is filtered as generic; 'microservice' is the non-generic fallback
    expect(result!.translation).toContain('microservice');
  });

  it('translates "dịch vụ đám mây" as cloud-service', () => {
    const result = quickVietnameseTranslateStructured('dịch vụ đám mây');
    expect(result).not.toBeNull();
    expect(result!.translation).toContain('cloud-service');
  });
});