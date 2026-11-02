import { describe, it, expect, vi } from 'vitest';
import { QueryGenerator } from '../../src/main/search/query-gen';
import { RankingEngine } from '../../src/main/ranking/engine';
import { RefinementValidator } from '../../src/main/search/refinement-validator';
import { detectAlternativeRequest } from '../../src/main/search/intent-decomposer';
import { makeMockRepo } from '../mocks/github';
import type { GitHubRepo, SearchCriteria } from '../../src/shared/types';
import type { ILlmClient } from '../../src/main/llm/types';

function mockLlm(response: string) {
  return {
    checkConnection: vi.fn().mockResolvedValue({ connected: true, models: [] }),
    listModels: vi.fn().mockResolvedValue([]),
    generate: vi.fn().mockResolvedValue(response),
  } as unknown as ILlmClient;
}

describe('LLM & Search Repos Accuracy Suite', () => {
  // =========================================================================
  // 1. LLM Query Generation & Intent Accuracy
  // =========================================================================
  describe('QueryGenerator: Intent Extraction & Search Strategy Accuracy', () => {
    it('accurately injects alternative search context and preserves benchmark entities', async () => {
      const client = mockLlm(JSON.stringify({
        searchQueries: ['open source pdf editor', 'pdf toolkit annotate sign', 'client-side pdf tools'],
        technologies: ['TypeScript', 'WebAssembly'],
        intent: 'desktop-app',
        minStars: 50,
        preferredLicense: 'mit',
        requireRecentActivity: true,
        benchmarkEntity: 'Adobe Acrobat',
        targetFeatures: ['annotate', 'sign', 'merge', 'split', 'compress'],
        topicTags: ['pdf-editor', 'pdf-tools', 'pdf-toolkit'],
      }));

      const qg = new QueryGenerator(client, 'test-model');
      const criteria = await qg.extractCriteria('phần mềm thay thế cho pdf editor của Adobe');

      // Check prompt received critical alternative replacement instructions
      const promptArg = (client.generate as any).mock.calls[0][0];
      expect(promptArg).toContain('CRITICAL INSTRUCTION - REPLACEMENT / ALTERNATIVE QUERY');
      expect(promptArg).toContain('Adobe Acrobat');
      expect(promptArg).toContain('Core domain to search: "pdf editor"');

      // Check extracted criteria fields
      expect(criteria.benchmarkEntity).toBe('Adobe Acrobat');
      expect(criteria.targetFeatures).toEqual(
        expect.arrayContaining(['annotate', 'sign', 'merge', 'split', 'compress'])
      );
      expect(criteria.topicTags).toContain('pdf-editor');
      expect(criteria.keywords).toHaveLength(3);
      expect(criteria.technologies).toContain('TypeScript');
    });

    it('robustly parses LLM JSON with code fences and extra conversational text', async () => {
      const messyLlmResponse = `
Here is the JSON search criteria you requested:
\`\`\`json
{
  "searchQueries": ["kubernetes deployment tool", "k8s gitops automation"],
  "technologies": ["Go"],
  "intent": "devops-tool",
  "minStars": 100,
  "preferredLicense": "apache-2.0",
  "requireRecentActivity": true
}
\`\`\`
Hope this helps!
`;
      const client = mockLlm(messyLlmResponse);
      const qg = new QueryGenerator(client, 'test-model');
      const criteria = await qg.extractCriteria('tools for deploying on kubernetes');

      expect(criteria.keywords).toEqual(['kubernetes deployment tool', 'k8s gitops automation']);
      expect(criteria.technologies).toEqual(['Go']);
      expect(criteria.intent).toBe('devops-tool');
      expect(criteria.minStars).toBe(100);
      expect(criteria.preferredLicense).toBe('apache-2.0');
    });

    it('auto-repairs truncated JSON output from constrained or token-limited LLMs', async () => {
      // Truncated response missing closing braces/brackets
      const truncatedLlmResponse = '{"searchQueries": ["vector database", "similarity search"], "technologies": ["Rust", "Python';
      const client = mockLlm(truncatedLlmResponse);
      const qg = new QueryGenerator(client, 'test-model');

      const criteria = await qg.extractCriteria('vector database in rust');
      expect(criteria.keywords).toContain('vector database');
      expect(criteria.technologies).toContain('Rust');
    });

    it('generates direct topic: and feature-based composite queries in buildSearchParamsArray', () => {
      const qg = new QueryGenerator(mockLlm('{}'), 'test-model');
      const criteria: SearchCriteria = {
        keywords: ['pdf editor open-source'],
        technologies: ['TypeScript'],
        intent: 'desktop-app',
        useCase: 'pdf editor',
        minStars: 0,
        preferredLicense: 'mit',
        requireRecentActivity: false,
        benchmarkEntity: 'Adobe Acrobat',
        targetFeatures: ['annotate', 'sign', 'merge'],
        topicTags: ['pdf-editor', 'pdf-tools'],
      };

      const params = qg.buildSearchParamsArray(criteria);
      const queries = params.map(p => p.query);

      // Verify topic query generation
      expect(queries).toContain('topic:pdf-editor');
      expect(queries).toContain('topic:pdf-tools');

      // Verify composite feature query generation: combines base keyword + top features
      const featureQuery = queries.find(q => q.includes('annotate sign merge'));
      expect(featureQuery).toBeDefined();
      expect(featureQuery).toContain('pdf editor');
      expect(featureQuery).toContain('annotate sign merge');
    });

    it('avoids emitting generic single-word queries from expanded Vietnamese keywords', () => {
      const qg = new QueryGenerator(mockLlm('{}'), 'test-model');
      const criteria: SearchCriteria = {
        keywords: ['restaurant pos system'],
        technologies: [],
        intent: 'retail-pos',
        useCase: 'quản lý nhà hàng và quán cafe',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'quản lý nhà hàng và quán cafe',
        expandedKeywords: [
          'restaurant', 'cafe', 'pos', 'retail', 'management', 'admin', 'billing', 'inventory'
        ],
        technicalConcepts: ['restaurant-pos', 'point-of-sale'],
      };

      const params = qg.buildSearchParamsArray(criteria);
      const queries = params.map(p => p.query);

      // Primary keyword is preserved
      expect(queries).toContain('restaurant pos system');

      // Single-word generic terms that match millions of repos must NOT be standalone queries
      expect(queries).not.toContain('management');
      expect(queries).not.toContain('admin');
      expect(queries).not.toContain('pos');
      expect(queries).not.toContain('retail');
      expect(queries).not.toContain('restaurant');
      expect(queries).not.toContain('cafe');
    });

    it('passes negative space gaps and score distribution directives to refinement suggestions prompt', async () => {
      const client = mockLlm(JSON.stringify(['only TypeScript projects', 'above 1000 stars']));
      const qg = new QueryGenerator(client, 'test-model');

      const repos = [
        makeMockRepo({ language: 'Go', description: 'Server monitoring tool', topics: ['monitoring', 'metrics'] }),
        makeMockRepo({ language: 'Go', description: 'Metrics collector', topics: ['metrics'] }),
      ];

      await qg.generateRefinementSuggestions(
        'real-time server monitoring dashboard with alerting',
        ['server monitoring', 'metrics'],
        ['Go'],
        'monitoring',
        2,
        repos,
        { top: 40, median: 35, bottom: 20, above80: 0, below50: 2, total: 2 },
        { narrowCount: 3, broadCount: 0 },
      );

      const promptArg = (client.generate as any).mock.calls[0][0];
      // Should include low-score alert
      expect(promptArg).toContain('Poor match');
      // Should include low-cardinality directive (< 5 results)
      expect(promptArg).toContain('Only 5 or fewer results found');
      // Should include user feedback pattern
      expect(promptArg).toContain('USER PATTERN: User has narrowed several times');
    });

    it('filters out hallucinated dummy placeholders from refinement suggestions', async () => {
      const client = mockLlm(JSON.stringify([
        'suggestion 1',
        'suggest 2',
        'example 3',
        'only Rust implementations',
        'query 4',
        'focus on zero-dependency libraries'
      ]));
      const qg = new QueryGenerator(client, 'test-model');

      const suggestions = await qg.generateRefinementSuggestions(
        'fast JSON parser',
        ['json parser', 'fast'],
        ['Rust'],
        'library',
        15,
        [makeMockRepo({ language: 'Rust', description: 'Simd JSON parser' })],
      );

      expect(suggestions).toEqual([
        'only Rust implementations',
        'focus on zero-dependency libraries',
      ]);
    });

    it('propagates benchmarkEntity, targetFeatures, and topicTags through refineCriteria', async () => {
      const client = mockLlm(JSON.stringify({
        keywords: ['client-side pdf editor', 'browser pdf toolkit'],
        technologies: ['TypeScript', 'Rust'],
        intent: 'desktop-app',
        weightEmphasis: { semanticMatch: 2.5, starsScore: 0.5 },
      }));

      const qg = new QueryGenerator(client, 'test-model');
      const originalCriteria: SearchCriteria = {
        keywords: ['pdf editor open source'],
        technologies: ['TypeScript'],
        intent: 'desktop-app',
        useCase: 'phần mềm thay thế Adobe Acrobat',
        minStars: 0,
        preferredLicense: 'mit',
        requireRecentActivity: false,
        benchmarkEntity: 'Adobe Acrobat',
        targetFeatures: ['annotate', 'sign', 'merge', 'split'],
        topicTags: ['pdf-editor', 'pdf-tools'],
      };

      const refined = await qg.refineCriteria(originalCriteria, 'thêm hỗ trợ Rust và WebAssembly', 'phần mềm thay thế Adobe Acrobat');

      expect(refined.benchmarkEntity).toBe('Adobe Acrobat');
      expect(refined.targetFeatures).toEqual(['annotate', 'sign', 'merge', 'split']);
      expect(refined.topicTags).toEqual(['pdf-editor', 'pdf-tools']);
      expect(refined.technologies).toContain('Rust');
      expect(refined.weightEmphasis?.semanticMatch).toBe(2.5);
    });
  });

  // =========================================================================
  // 2. Ranking Engine Accuracy & Domain Precision
  // =========================================================================
  describe('RankingEngine: Search Accuracy & Domain Specialization', () => {
    const engine = new RankingEngine();

    it('ranks a specialized tool matching topics/features higher than a famous generic library', async () => {
      // Specialized tool: only 250 stars, but matches pdf-editor topic & key features
      const specializedPdfTool = makeMockRepo({
        id: 101,
        full_name: 'acme/browser-pdf-editor',
        description: 'Complete client-side PDF toolkit: edit, annotate, sign, and merge documents.',
        stars: 250,
        topics: ['pdf-editor', 'pdf-tools', 'pdf'],
        language: 'TypeScript',
        updated_at: new Date().toISOString(),
      });

      // Famous generic repo: 50,000 stars, but is just a generic viewer/script without editing capabilities
      const genericHighStarRepo = makeMockRepo({
        id: 102,
        full_name: 'giant/pdf-viewer',
        description: 'General purpose PDF rendering and viewing engine.',
        stars: 50000,
        topics: ['pdf', 'viewer', 'javascript'],
        language: 'JavaScript',
        updated_at: new Date().toISOString(),
      });

      const criteria: SearchCriteria = {
        keywords: ['pdf editor', 'annotate sign merge pdf'],
        technologies: ['TypeScript'],
        intent: 'desktop-app',
        useCase: 'phần mềm thay thế Adobe Acrobat',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: true,
        benchmarkEntity: 'Adobe Acrobat',
        targetFeatures: ['annotate', 'sign', 'merge', 'split', 'compress'],
        topicTags: ['pdf-editor', 'pdf-tools'],
      };

      const readmes = new Map<number, string | null>([
        [101, '# Browser PDF Editor\nFree open source toolkit to annotate, sign, merge and convert PDF files in browser.'],
        [102, '# PDF Viewer\nRender PDFs to HTML5 canvas.'],
      ]);

      const ranked = await engine.rank([genericHighStarRepo, specializedPdfTool], criteria, readmes, criteria.useCase, 10);

      // Specialized tool should win #1 despite having 200x fewer stars
      expect(ranked[0].repo.id).toBe(101);
      expect(ranked[0].score.semanticMatch).toBeGreaterThan(ranked[1].score.semanticMatch);
      expect(ranked[0].score.total).toBeGreaterThan(ranked[1].score.total);
    });

    it('mitigates credibility discount for low-star repos when topicTags or targetFeatures match', () => {
      const lowStarSpecialized = makeMockRepo({
        stars: 80, // Under 100 stars
        description: 'Client-side PDF editor toolkit to annotate and sign files.',
        topics: ['pdf-editor'],
      });

      const lowStarGeneric = makeMockRepo({
        stars: 80, // Under 100 stars
        description: 'A random collection of tools.',
        topics: ['tools'],
      });

      const criteria: SearchCriteria = {
        keywords: ['pdf editor toolkit'],
        technologies: [],
        intent: 'desktop-app',
        useCase: 'pdf editor',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        topicTags: ['pdf-editor'],
        targetFeatures: ['annotate', 'sign'],
      };

      const scoreSpecialized = engine.scoreRepo(lowStarSpecialized, criteria, null, 'pdf editor');
      const scoreGeneric = engine.scoreRepo(lowStarGeneric, criteria, null, 'pdf editor');

      // The specialized tool gets only a 0.9 discount, while the generic tool gets a 0.6-0.73 discount
      expect(scoreSpecialized.semanticMatch).toBeGreaterThan(scoreGeneric.semanticMatch * 1.5);
    });

    it('boosts repositories whose topics align with the canonical intent topic cluster', () => {
      // Repo A has topics matching the devops-tool cluster ('ci-cd', 'pipeline')
      const devopsRepo = makeMockRepo({
        full_name: 'org/delivery-runner',
        description: 'Automated runner for application releases',
        topics: ['ci-cd', 'pipeline', 'automation'],
      });

      // Repo B has generic topics
      const genericRepo = makeMockRepo({
        full_name: 'org/general-runner',
        description: 'Automated runner for application releases',
        topics: ['utility', 'script'],
      });

      const criteria: SearchCriteria = {
        keywords: ['automated runner releases'],
        technologies: [],
        intent: 'devops-tool', // Triggers INTENT_TOPIC_CLUSTERS['devops-tool']
        useCase: 'delivery runner',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      };

      const scoreA = engine.scoreRepo(devopsRepo, criteria, null, 'runner');
      const scoreB = engine.scoreRepo(genericRepo, criteria, null, 'runner');

      expect(scoreA.semanticMatch).toBeGreaterThan(scoreB.semanticMatch);
    });

    it('accurately blends neural vector similarity with sparse lexical matching', async () => {
      const repo = makeMockRepo({
        id: 777,
        full_name: 'org/hybrid-search',
        description: 'Search engine with dense vector retrieval',
        stars: 1000,
      });

      const criteria: SearchCriteria = {
        keywords: ['search engine'],
        technologies: [],
        intent: 'database',
        useCase: 'search engine',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      };

      // Rank without vector score
      const unboosted = await engine.rank([repo], criteria, new Map(), 'search engine', 1);

      // Rank with high vector similarity score (0.95)
      const vectorScores = new Map<number, number>([[777, 0.95]]);
      const boosted = await engine.rank([repo], criteria, new Map(), 'search engine', 1, undefined, vectorScores);

      expect(boosted[0].score.semanticMatch).toBeGreaterThan(unboosted[0].score.semanticMatch);
      expect(boosted[0].score.total).toBeGreaterThan(unboosted[0].score.total);
    });

    it('exhibits soft saturation where additional matching tokens increase score without hard capping', () => {
      const baseRepo = makeMockRepo({
        full_name: 'org/monitoring-dashboard',
        description: 'real-time server monitoring dashboard with alerting and metrics',
        topics: ['monitoring', 'metrics', 'dashboard'],
      });

      const extraMatchRepo = makeMockRepo({
        full_name: 'org/monitoring-dashboard-server',
        description: 'real-time server monitoring dashboard with alerting, metrics, observability, and telemetry',
        topics: ['monitoring', 'metrics', 'dashboard', 'observability', 'telemetry'],
      });

      const criteria: SearchCriteria = {
        keywords: [
          'monitoring dashboard',
          'server metrics',
          'real-time alerting',
          'observability telemetry',
        ],
        technologies: [],
        intent: 'monitoring',
        useCase: 'server monitoring dashboard',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      };

      const score1 = engine.scoreRepo(baseRepo, criteria, null, criteria.useCase);
      const score2 = engine.scoreRepo(extraMatchRepo, criteria, null, criteria.useCase);

      expect(score2.semanticMatch).toBeGreaterThan(score1.semanticMatch);
      // Both should be valid numbers < 1.0 (asymptotic)
      expect(score2.semanticMatch).toBeLessThan(1.0);
      expect(score1.semanticMatch).toBeLessThan(1.0);
    });

    it('matches language with exact match=1.0, prefix/word boundary=0.7, mismatch=0.2', () => {
      const repoTS = makeMockRepo({ language: 'TypeScript' });
      const repoJS = makeMockRepo({ language: 'JavaScript' });
      const repoGo = makeMockRepo({ language: 'Go' });
      const repoNull = makeMockRepo({ language: null });

      const criteriaExact: SearchCriteria = {
        keywords: ['tool'],
        technologies: ['TypeScript'],
        intent: 'library',
        useCase: 'tool',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      };

      expect(engine.scoreRepo(repoTS, criteriaExact, null, 'tool').languageMatch).toBe(1.0);
      expect(engine.scoreRepo(repoGo, criteriaExact, null, 'tool').languageMatch).toBe(0.2);
      expect(engine.scoreRepo(repoNull, criteriaExact, null, 'tool').languageMatch).toBe(0.5);
    });

    it('accurately scores permissive license compatibility (MIT vs Apache-2.0 yields 0.85)', () => {
      const repoMit = makeMockRepo({ license: { key: 'mit', name: 'MIT' } });
      const repoApache = makeMockRepo({ license: { key: 'apache-2.0', name: 'Apache 2.0' } });
      const repoGpl = makeMockRepo({ license: { key: 'gpl-3.0', name: 'GPL 3.0' } });
      const repoNoLicense = makeMockRepo({ license: null });

      const criteriaMit: SearchCriteria = {
        keywords: ['tool'],
        technologies: [],
        intent: 'library',
        useCase: 'tool',
        minStars: 0,
        preferredLicense: 'mit',
        requireRecentActivity: false,
      };

      expect(engine.scoreRepo(repoMit, criteriaMit, null, 'tool').licenseCompatibility).toBe(1.0);
      expect(engine.scoreRepo(repoApache, criteriaMit, null, 'tool').licenseCompatibility).toBe(0.85);
      expect(engine.scoreRepo(repoGpl, criteriaMit, null, 'tool').licenseCompatibility).toBe(0.4);
      expect(engine.scoreRepo(repoNoLicense, criteriaMit, null, 'tool').licenseCompatibility).toBe(0.5);
    });
  });

  // =========================================================================
  // 3. Intent Decomposition Accuracy
  // =========================================================================
  describe('IntentDecomposer: Benchmark & Pattern Accuracy', () => {
    const cases = [
      {
        query: 'phần mềm thay thế cho Adobe Photoshop',
        isAlt: true,
        benchmark: 'Adobe Photoshop',
        domain: 'photo editor image manipulation',
        expectedTopic: 'photo-editor',
      },
      {
        query: 'open source alternative to notion',
        isAlt: true,
        benchmark: 'Notion',
        domain: 'knowledge base notes wiki',
        expectedTopic: 'wiki',
      },
      {
        query: 'công cụ thay thế jira',
        isAlt: true,
        benchmark: 'Jira',
        domain: 'issue tracker project management',
        expectedTopic: 'issue-tracker',
      },
      {
        query: 'tương tự như Postman nhưng nhẹ hơn',
        isAlt: true,
        benchmark: 'Postman',
        domain: 'api client testing',
        expectedTopic: 'api-client',
      },
      {
        query: 'like trello but open source',
        isAlt: true,
        benchmark: 'Trello',
        domain: 'kanban board task management',
        expectedTopic: 'kanban',
      },
      {
        query: 'ứng dụng thay thế figma trên linux',
        isAlt: true,
        benchmark: 'Figma',
        domain: 'ui design vector graphics',
        expectedTopic: 'ui-design',
      },
      {
        query: 'giống như Slack để chat nội bộ công ty',
        isAlt: true,
        benchmark: 'Slack',
        domain: 'team chat messaging',
        expectedTopic: 'chat',
      },
    ];

    for (const c of cases) {
      it(`correctly detects and decomposes benchmark for "${c.query}"`, () => {
        const res = detectAlternativeRequest(c.query);
        expect(res.isAlternative).toBe(c.isAlt);
        expect(res.benchmark).toBe(c.benchmark);
        expect(res.cleanCoreDomain).toBe(c.domain);
        expect(res.suggestedTopics).toContain(c.expectedTopic);
        expect(res.suggestedFeatures?.length).toBeGreaterThanOrEqual(3);
        expect(res.suggestedQueries?.length).toBeGreaterThanOrEqual(2);
      });
    }

    it('returns isAlternative: false for non-alternative queries', () => {
      const nonAltQueries = [
        'build a slack bot with node.js',
        'notion api documentation example',
        'jira webhook configuration',
        'python library for pdf manipulation',
        'fast web framework in rust',
      ];

      for (const q of nonAltQueries) {
        const res = detectAlternativeRequest(q);
        expect(res.isAlternative).toBe(false);
        expect(res.benchmark).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 4. Refinement Validator Accuracy Guardrails
  // =========================================================================
  describe('RefinementValidator: Guardrail Accuracy', () => {
    const validator = new RefinementValidator();

    it('drops suggestions that are redundant with already active filters', () => {
      const repos = [
        makeMockRepo({ language: 'TypeScript', license: { key: 'mit', name: 'MIT' } }),
        makeMockRepo({ language: 'TypeScript', license: { key: 'mit', name: 'MIT' } }),
      ];

      const res = validator.validate(
        ['only TypeScript projects', 'only MIT-licensed', 'above 500 stars'],
        repos,
        { language: 'typescript', license: 'mit' },
      );

      expect(res.valid).toEqual(['above 500 stars']);
      expect(res.dropped).toHaveLength(2);
      expect(res.dropped[0].reason).toContain('already filtered to typescript');
      expect(res.dropped[1].reason).toContain('already filtered to mit');
    });

    it('drops suggestions whose cardinality in candidate repos is less than 2', () => {
      const repos = [
        makeMockRepo({ language: 'TypeScript', license: { key: 'mit', name: 'MIT' } }),
        makeMockRepo({ language: 'Go', license: { key: 'apache-2.0', name: 'Apache 2.0' } }),
      ];

      // Only 1 Rust repo exists (0 in fact), so "only Rust" must be dropped
      const res = validator.validate(
        ['only Rust projects', 'above 100 stars'],
        repos,
        {},
      );

      expect(res.valid).toContain('above 100 stars');
      expect(res.dropped.some(d => d.suggestion === 'only Rust projects')).toBe(true);
    });

    it('preserves suggestions as safety net if all would be dropped solely due to cardinality', () => {
      const repos = [
        makeMockRepo({ language: 'TypeScript' }),
      ];

      // Both suggestions would fail cardinality (< 2)
      const suggestions = ['only Go projects', 'only Rust projects'];
      const res = validator.validate(suggestions, repos, {});

      // Safety net kicks in when no redundancy drops occurred
      expect(res.valid).toEqual(suggestions);
      expect(res.dropped).toHaveLength(0);
    });
  });
});
