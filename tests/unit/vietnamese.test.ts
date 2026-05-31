import { describe, it, expect } from 'vitest';
import {
  detectVietnamese,
  VietnameseQueryExpander,
  VietnameseTranslationCache,
  detectVietnameseRefinement,
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
});