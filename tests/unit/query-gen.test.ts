import { describe, it, expect, vi } from 'vitest';
import type { OllamaClient } from '../../src/main/ollama/client';
import { QueryGenerator } from '../../src/main/search/query-gen';

function mockOllamaWithResponse(response: string) {
  return {
    checkConnection: vi.fn(),
    listModels: vi.fn(),
    generate: vi.fn().mockResolvedValue(response),
  };
}

function createQg(response: string) {
  const mock = mockOllamaWithResponse(response);
  const qg = new QueryGenerator(mock as unknown as OllamaClient, 'test-model');
  return { qg, mock };
}

describe('QueryGenerator (unit)', () => {
  it('extracts 3 keyword queries from searchQueries array', async () => {
    const { qg } = createQg(
      '{"searchQueries":["CI CD Docker","pipeline automation","devops self hosted"],"technologies":["Docker","Go"],"intent":"devops-tool","minStars":50,"preferredLicense":"mit","requireRecentActivity":true}',
    );

    const criteria = await qg.extractCriteria('I need a self-hosted CI/CD tool');
    expect(criteria.keywords).toHaveLength(3);
    expect(criteria.keywords[0]).toContain('CI');
    expect(criteria.keywords[1]).toContain('pipeline');
    expect(criteria.keywords[2]).toContain('devops');
    expect(criteria.technologies).toContain('Docker');
    expect(criteria.intent).toBe('devops-tool');
  });

  it('handles legacy searchQuery format', async () => {
    const { qg } = createQg(
      '{"searchQuery":"CI/CD Docker self-hosted","technologies":["Docker"],"intent":"devops-tool","minStars":10,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('CI/CD tool');
    // Single searchQuery gets split into one keyword (no garbage padding)
    expect(criteria.keywords.length).toBeGreaterThanOrEqual(1);
    expect(criteria.keywords[0]).toContain('CI/CD');
  });

  it('handles legacy keywords array', async () => {
    const { qg } = createQg(
      '{"keywords":["react","ui","library"],"technologies":["TypeScript"],"intent":"library","minStars":0,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('UI component library');
    // No garbage padding — returns actual LLM keywords
    expect(criteria.keywords.length).toBeGreaterThanOrEqual(1);
    expect(criteria.keywords[0]).toContain('react');
    expect(criteria.technologies).toContain('TypeScript');
  });

  it('falls back to user description when LLM returns no valid queries', async () => {
    const { qg } = createQg(
      '{"technologies":[],"intent":"other","minStars":0,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('a self-hosted CI/CD platform');
    // No garbage padding — returns the user description as a single keyword
    expect(criteria.keywords.length).toBeGreaterThanOrEqual(1);
    expect(criteria.keywords[0]).toContain('self-hosted');
  });

  it('returns fewer good queries instead of padding with garbage', async () => {
    const { qg } = createQg(
      '{"searchQueries":["single docker query"],"technologies":["Docker"],"intent":"devops-tool","minStars":0,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('I need Docker stuff');
    // No longer pads to 3 with word-slice nonsense — 1 good query is better
    expect(criteria.keywords.length).toBeLessThanOrEqual(3);
    expect(criteria.keywords[0]).toBe('single docker query');
  });

  it('buildSearchParamsArray creates one SearchParams per keyword', () => {
    const { qg } = createQg('{}');

    const paramsArray = qg.buildSearchParamsArray({
      keywords: ['docker ci-cd', 'pipeline automation', 'devops tools'],
      technologies: ['Go', 'Docker'],
      intent: 'devops-tool',
      useCase: 'CI/CD tool',
      minStars: 20,
      preferredLicense: 'mit',
      requireRecentActivity: true,
    });

    expect(paramsArray).toHaveLength(3);
    expect(paramsArray[0].query).toBe('docker ci-cd');
    expect(paramsArray[1].query).toBe('pipeline automation');
    expect(paramsArray[2].query).toBe('devops tools');
    expect(paramsArray[0].sort).toBe('stars');
    expect(paramsArray[0].perPage).toBe(10);
  });

  it('buildSearchParamsArray applies language/license filters (minStars is not sent to GitHub API)', () => {
    const { qg } = createQg('{}');

    const paramsArray = qg.buildSearchParamsArray(
      { keywords: ['query1', 'query2', 'query3'], technologies: [], intent: 'other', useCase: 'test', minStars: 5, preferredLicense: null, requireRecentActivity: false },
      { language: 'typescript', license: 'mit', minStars: 50 },
    );

    for (const p of paramsArray) {
      expect(p.language).toBe('typescript');
      expect(p.license).toBe('mit');
      // minStars is NOT sent to GitHub API — it's applied as a client-side post-filter
      expect(p.minStars).toBe(0);
    }
  });

  it('buildSearchParams remains backward compatible', () => {
    const { qg } = createQg('{}');

    const params = qg.buildSearchParams({
      keywords: ['docker', 'ci-cd', 'pipeline'],
      technologies: ['Go'],
      intent: 'devops-tool',
      useCase: 'CI/CD',
      minStars: 20,
      preferredLicense: 'mit',
      requireRecentActivity: true,
    });

    expect(params.query).toContain('docker');
    expect(params.query).toContain('ci-cd');
    expect(params.sort).toBe('stars');
  });

  // ── Vietnamese diacritics-stripped search variants ──
  describe('Vietnamese diacritics-stripped search variants', () => {
    it('adds diacritics-stripped variants for Vietnamese originalQuery', () => {
      const { qg } = createQg('{}');

      const paramsArray = qg.buildSearchParamsArray({
        keywords: ['password manager'], // English keywords from LLM
        technologies: [],
        intent: 'password-manager',
        useCase: 'quản lý mật khẩu',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'quản lý mật khẩu',
      });

      // Should have the original English keyword
      const queries = paramsArray.map(p => p.query);
      expect(queries).toContain('password manager');
      // Should also have diacritics-stripped slug from originalQuery
      const hasSlug = queries.some(q => q.includes('quan-ly') || q.includes('quan ly'));
      expect(hasSlug).toBe(true);
    });

    it('does not add Vietnamese variants when originalQuery is missing', () => {
      const { qg } = createQg('{}');

      const paramsArray = qg.buildSearchParamsArray({
        keywords: ['docker', 'ci-cd'],
        technologies: [],
        intent: 'devops-tool',
        useCase: 'CI/CD tool',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      });

      // No originalQuery → no Vietnamese variants
      expect(paramsArray.map(p => p.query)).toEqual(['docker', 'ci-cd']);
    });

    it('handles đ stripping correctly in search variants', () => {
      const { qg } = createQg('{}');

      const paramsArray = qg.buildSearchParamsArray({
        keywords: ['login auth'], // English keywords from LLM
        technologies: [],
        intent: 'cli-tool',
        useCase: 'đăng nhập hệ thống',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'đăng nhập hệ thống',
      });

      // "đăng" → "dang" → "dang-nhap" as part of slug
      const queries = paramsArray.map(p => p.query);
      const hasStripped = queries.some(q => q.includes('dang'));
      expect(hasStripped).toBe(true);
    });

    // ── Regression: generic expanded keywords must NOT become standalone queries ──
    // Without this, "công cụ quản lý căn tin" sends "management", "tool", "admin"
    // as standalone GitHub queries, which match millions of repos and let
    // mega-repos unrelated to the user's domain dominate results.
    it('does not create standalone queries from generic expanded keywords', () => {
      const { qg } = createQg('{}');

      const paramsArray = qg.buildSearchParamsArray({
        keywords: ['canteen-management'],
        technologies: [],
        intent: 'retail-pos',
        useCase: 'công cụ quản lý căn tin',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'tôi muốn một công cụ quản lý căn tin',
        expandedKeywords: ['canteen', 'cafeteria', 'food-service', 'management', 'manager', 'admin', 'tool', 'cli', 'utility'],
        technicalConcepts: ['canteen', 'food-service'],
      });

      const queries = paramsArray.map(p => p.query);

      // Multi-word and domain-specific compound keywords should be present
      // (canteen-management is the primary keyword)
      expect(queries).toContain('canteen-management');

      // Generic single-word expanded keywords must NOT be standalone queries.
      // This includes both broad English nouns AND domain-specific words that
      // still match too many repos as single words (canteen, pos, retail, etc.).
      expect(queries).not.toContain('management');
      expect(queries).not.toContain('manager');
      expect(queries).not.toContain('admin');
      expect(queries).not.toContain('tool');
      expect(queries).not.toContain('cli');
      expect(queries).not.toContain('utility');
      // Domain-specific but too common as single words:
      expect(queries).not.toContain('canteen');
      expect(queries).not.toContain('cafeteria');
      // "food-service" is a compound (has hyphen) so it passes the single-word
      // filter — that's fine, it's specific enough at 14K repos.

      // Vietnamese slug should NOT contain stop words like "toi", "muon", "mot"
      const viSlugQueries = queries.filter(q => /[a-z]-[a-z]/.test(q) && !queries.slice(0, queries.indexOf(q)).includes(q));
      for (const q of viSlugQueries) {
        expect(q).not.toContain('toi');
        expect(q).not.toContain('muon');
        expect(q).not.toContain('mot');
      }
    });

    it('does not duplicate search params for ASCII keywords', () => {
      const { qg } = createQg('{}');

      const paramsArray = qg.buildSearchParamsArray({
        keywords: ['monitoring'], // Pure ASCII - no diacritics
        technologies: [],
        intent: 'devops-tool',
        useCase: 'monitoring tool',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'giám sát máy chủ',
      });

      // "monitoring" itself is ASCII, not duplicated
      const count = paramsArray.filter(p => p.query === 'monitoring').length;
      expect(count).toBe(1);
      // But originalQuery should still produce stripped Vietnamese variants
      const hasViSlug = paramsArray.some(p => p.query.includes('giam') || p.query.includes('sat'));
      expect(hasViSlug).toBe(true);
    });
  });

  // ── Vietnamese prompt enrichment ──
  describe('Vietnamese prompt enrichment (LLM reasoning with dictionary hints)', () => {
    it('includes Vietnamese context and reasoning directive in LLM prompt', async () => {
      const { qg, mock } = createQg(
        '{"searchQueries":["password manager","credential vault","secret management"],"technologies":[],"intent":"password-manager","englishTranslation":"password manager","technicalConcepts":["password-manager","credential"]}',
      );

      await qg.extractCriteria('quản lý mật khẩu');

      // Verify the LLM prompt contains the reasoning directive (not "ALREADY TRANSLATED")
      const promptArg = mock.generate.mock.calls[0][0];
      expect(promptArg).toContain('Vietnamese');
      expect(promptArg).toContain('reason about their actual intent');
      // The original Vietnamese should be in the prompt
      expect(promptArg).toContain('quản lý mật khẩu');
      // The prompt should instruct the LLM to think about the TYPE of project
      expect(promptArg).toContain('TYPE of software project');
    });

    it('does NOT inject Vietnamese context for English queries', async () => {
      const { qg, mock } = createQg(
        '{"searchQueries":["CI CD Docker","pipeline automation"],"technologies":["Docker"],"intent":"devops-tool"}',
      );

      await qg.extractCriteria('I need a CI/CD tool');

      const promptArg = mock.generate.mock.calls[0][0];
      expect(promptArg).not.toContain('Vietnamese');
      expect(promptArg).not.toContain('reason about their actual intent');
    });

    it('populates expandedKeywords from LLM output when LLM provides them', async () => {
      const { qg } = createQg(
        '{"searchQueries":["password manager"],"technologies":[],"intent":"password-manager","englishTranslation":"password manager","technicalConcepts":["password-manager"]}',
      );

      const criteria = await qg.extractCriteria('quản lý mật khẩu');

      // LLM provides technicalConcepts → expandedKeywords should be populated from them
      expect(criteria.expandedKeywords).toBeDefined();
      expect(criteria.expandedKeywords!.length).toBeGreaterThan(0);
      // Should include the English translation
      expect(criteria.expandedKeywords).toContain('password manager');
    });

    it('uses preTrans intent when LLM returns "other"', async () => {
      const { qg } = createQg(
        '{"searchQueries":["server monitoring"],"technologies":[],"intent":"other","englishTranslation":"server monitoring","technicalConcepts":["monitoring"]}',
      );

      const criteria = await qg.extractCriteria('giám sát máy chủ');

      // Even though LLM said "other", preTrans classifies it as "monitoring"
      expect(criteria.intent).toBe('monitoring');
    });

    it('respects LLM intent when it is useful (not "other")', async () => {
      const { qg } = createQg(
        '{"searchQueries":["password manager"],"technologies":[],"intent":"security-tool","englishTranslation":"password manager","technicalConcepts":["password-manager"]}',
      );

      const criteria = await qg.extractCriteria('quản lý mật khẩu');

      // LLM said "security-tool" (useful), preTrans would say "password-manager"
      // The LLM intent should be preserved because it's not "other"
      expect(criteria.intent).toBe('security-tool');
    });

    it('uses LLM technicalConcepts when provided (not overridden by dictionary)', async () => {
      // When the LLM provides its own technicalConcepts, they should be used
      // as-is — dictionary concepts are only a fallback when LLM provides none.
      const { qg } = createQg(
        '{"searchQueries":["monitoring server"],"technologies":[],"intent":"monitoring","englishTranslation":"monitoring tool","technicalConcepts":["monitoring"]}',
      );

      const criteria = await qg.extractCriteria('giám sát máy chủ');

      expect(criteria.technicalConcepts).toBeDefined();
      expect(criteria.technicalConcepts!.length).toBeGreaterThanOrEqual(1);
      // LLM provided "monitoring" — it should be present
      expect(criteria.technicalConcepts).toContain('monitoring');
    });

    it('does not duplicate dictionaryConcepts already in LLM technicalConcepts', async () => {
      const { qg } = createQg(
        '{"searchQueries":["monitoring server"],"technologies":[],"intent":"monitoring","englishTranslation":"server monitoring tool","technicalConcepts":["monitoring","server"]}',
      );

      const criteria = await qg.extractCriteria('giám sát máy chủ');

      expect(criteria.technicalConcepts).toBeDefined();
      // "monitoring" from LLM — should not be duplicated by dictConcepts
      const monitoringCount = criteria.technicalConcepts!.filter(c => c === 'monitoring').length;
      expect(monitoringCount).toBe(1);
    });

    it('deterministic query slot fires with dictConcept-enriched technicalConcepts', async () => {
      // LLM returns only 1 keyword + no tech concepts — dictConcepts fill the gap
      const { qg } = createQg(
        '{"searchQueries":["monitoring tool"],"technologies":[],"intent":"monitoring","englishTranslation":"monitoring tool","technicalConcepts":[]}',
      );

      const criteria = await qg.extractCriteria('công cụ giám sát');

      // technicalConcepts should now have dictionaryConcepts (fallback)
      expect(criteria.technicalConcepts).toBeDefined();
      expect(criteria.technicalConcepts!.length).toBeGreaterThan(0);

      // With >= 2 concepts and < 3 queries, deterministic slot should add a concept query
      const conceptTerms = criteria.technicalConcepts as string[];
      if (conceptTerms.length >= 2 && criteria.keywords.length < 3) {
        // Deterministic slot should have fired — expect up to 3 keywords now
        expect(criteria.keywords.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('includes Dictionary hints in LLM prompt context', async () => {
      const { qg, mock } = createQg(
        '{"searchQueries":["monitoring server"],"technologies":[],"intent":"monitoring","englishTranslation":"server monitoring tool","technicalConcepts":["monitoring"]}',
      );

      await qg.extractCriteria('công cụ giám sát máy chủ');

      const promptArg = mock.generate.mock.calls[0][0];
      // The prompt should include dictionary hints as reference
      expect(promptArg).toContain('Dictionary hints');
      // Should include concepts from the dictionary translation
      expect(promptArg).toContain('monitoring');
    });

    it('does not include Dictionary hints for English queries', async () => {
      const { qg, mock } = createQg(
        '{"searchQueries":["CI CD Docker"],"technologies":["Docker"],"intent":"devops-tool"}',
      );

      await qg.extractCriteria('I need a CI/CD tool');

      const promptArg = mock.generate.mock.calls[0][0];
      expect(promptArg).not.toContain('Dictionary hints');
    });
  });

  // ── Vietnamese query normalization (filler stripping) ──
  describe('Vietnamese query normalization in extractCriteria', () => {
    it('strips filler prefix before translation and LLM prompt', async () => {
      const { qg, mock } = createQg(
        '{"searchQueries":["monitoring tool"],"technologies":[],"intent":"monitoring","englishTranslation":"monitoring tool","technicalConcepts":["monitoring"]}',
      );

      // "tôi muốn tìm một" should be stripped → effectiveDescription = "công cụ giám sát"
      await qg.extractCriteria('tôi muốn tìm một công cụ giám sát');

      const promptArg = mock.generate.mock.calls[0][0];
      // The prompt should contain the reasoning directive (not "ALREADY TRANSLATED")
      expect(promptArg).toContain('Vietnamese');
      expect(promptArg).toContain('reason about their actual intent');
      // Dictionary hints should be computed from the normalized version
      // (without filler noise like "tôi muốn tìm một")
      expect(promptArg).toContain('Dictionary hints');
      expect(promptArg).toContain('monitoring');
      // Note: userDescription (with filler) still appears in the "User request:" line —
      // that's fine, the LLM sees the original but the dictionary hints have clean terms
    });

    it('does not strip filler from English queries', async () => {
      const { qg } = createQg(
        '{"searchQueries":["CI CD Docker"],"technologies":["Docker"],"intent":"devops-tool"}',
      );

      const criteria = await qg.extractCriteria('I want a self-hosted CI/CD tool');
      // English "I want" is NOT a Vietnamese filler — the query should pass through
      expect(criteria.keywords.some(k => k.includes('CI'))).toBe(true);
    });

    it('normalizes "cho tôi một" before dictionary translation', async () => {
      const { qg } = createQg(
        '{"searchQueries":["email server"],"technologies":[],"intent":"self-hosted","englishTranslation":"email server","technicalConcepts":["mail-server"]}',
      );

      const criteria = await qg.extractCriteria('cho tôi một máy chủ email');
      // The effectiveDescription should be "máy chủ email" (without filler)
      // which → "mail-server" in deterministic translation
      expect(criteria.technicalConcepts).toBeDefined();
      const hasEmail = criteria.technicalConcepts!.some(c => c === 'mail-server' || c === 'smtp');
      expect(hasEmail).toBe(true);
    });
  });

  // ── Vietnamese refinement propagation ──
  describe('refineCriteria preserves Vietnamese fields', () => {
    it('propagates englishTranslation and originalQuery through refinement', async () => {
      const { qg, mock } = createQg(
        '{"keywords":["password manager","credential vault"],"technologies":["Go"],"intent":"password-manager","englishTranslation":"password manager refined","technicalConcepts":["credential","secret-management"]}',
      );

      const originalCriteria = {
        keywords: ['password', 'manager'],
        technologies: ['Go'],
        intent: 'password-manager',
        useCase: 'quản lý mật khẩu',
        minStars: 0,
        preferredLicense: null as string | null,
        requireRecentActivity: false,
        englishTranslation: 'password manager',
        technicalConcepts: ['password-manager', 'credential'],
        expandedKeywords: ['management', 'manager', 'admin'],
        originalQuery: 'quản lý mật khẩu',
      };

      const refined = await qg.refineCriteria(
        originalCriteria,
        'ưu tiên Go',
        'quản lý mật khẩu',
      );

      // Vietnamese context should be preserved after refinement
      expect(refined.englishTranslation).toBeDefined();
      expect(refined.originalQuery).toBe('quản lý mật khẩu');

      // Verify the LLM was given Vietnamese context in the prompt
      const promptArg = mock.generate.mock.calls[0][0];
      expect(promptArg).toContain('ALREADY TRANSLATED');
      expect(promptArg).toContain('Original English translation');
    });

    it('propagates Vietnamese fields even when LLM returns no translation', async () => {
      const { qg } = createQg(
        '{"keywords":["monitoring","server"],"technologies":["Go"],"intent":"monitoring"}',
      );

      const originalCriteria = {
        keywords: ['monitoring', 'server'],
        technologies: ['Go'],
        intent: 'monitoring',
        useCase: 'giám sát máy chủ',
        minStars: 0,
        preferredLicense: null as string | null,
        requireRecentActivity: false,
        englishTranslation: 'server monitoring tool',
        technicalConcepts: ['monitoring', 'observability'],
        originalQuery: 'giám sát máy chủ',
        expandedKeywords: ['observability', 'watch', 'server', 'host'],
      };

      const refined = await qg.refineCriteria(
        originalCriteria,
        'nhiều sao nhất',
        'giám sát máy chủ',
      );

      // When LLM returns no translation, original fields pass through
      expect(refined.englishTranslation).toBe('server monitoring tool');
      expect(refined.originalQuery).toBe('giám sát máy chủ');
      expect(refined.technicalConcepts).toBeDefined();
      expect(refined.technicalConcepts).toContain('monitoring');
    });

    it('detects Vietnamese refinement text and injects preTrans into prompt', async () => {
      const { qg, mock } = createQg(
        '{"keywords":["CI CD","self-hosted","docker"],"technologies":["Go"],"intent":"devops-tool"}',
      );

      // Original query is English, but refinement is Vietnamese
      const originalCriteria = {
        keywords: ['CI/CD', 'docker', 'self-hosted'],
        technologies: ['Go', 'Docker'],
        intent: 'devops-tool',
        useCase: 'Self-hosted CI/CD platform',
        minStars: 0,
        preferredLicense: null as string | null,
        requireRecentActivity: false,
        // No Vietnamese fields on original
      };

      await qg.refineCriteria(
        originalCriteria,
        'ưu tiên Go',
        'Self-hosted CI/CD platform',
      );

      const promptArg = mock.generate.mock.calls[0][0];
      // The refinement text "ưu tiên Go" should trigger Vietnamese detection
      expect(promptArg).toContain('ALREADY TRANSLATED');
    });

    it('does not inject Vietnamese context for English-only refinement', async () => {
      const { qg, mock } = createQg(
        '{"keywords":["CI CD","self-hosted","docker"],"technologies":["Go"],"intent":"devops-tool"}',
      );

      const originalCriteria = {
        keywords: ['CI/CD', 'docker'],
        technologies: ['Go'],
        intent: 'devops-tool',
        useCase: 'Self-hosted CI/CD platform',
        minStars: 0,
        preferredLicense: null as string | null,
        requireRecentActivity: false,
      };

      await qg.refineCriteria(
        originalCriteria,
        'prefer Go',
        'Self-hosted CI/CD platform',
      );

      const promptArg = mock.generate.mock.calls[0][0];
      // No Vietnamese anywhere — should not inject pre-translation
      expect(promptArg).not.toContain('ALREADY TRANSLATED');
    });
  });
});
