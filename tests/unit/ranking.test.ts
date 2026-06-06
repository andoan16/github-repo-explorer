import { describe, it, expect } from 'vitest';
import { RankingEngine } from '../../src/main/ranking/engine';
import { QueryGenerator } from '../../src/main/search/query-gen';
import { makeMockRepo } from '../mocks/github';
import type { SearchCriteria } from '../../src/shared/types';

const engine = new RankingEngine();

const criteria: SearchCriteria = {
  keywords: ['CI/CD', 'docker', 'self-hosted', 'pipeline'],
  technologies: ['Go', 'Docker', 'TypeScript'],
  intent: 'devops-tool',
  useCase: 'Self-hosted CI/CD platform',
  minStars: 10,
  preferredLicense: 'mit',
  requireRecentActivity: true,
};

describe('RankingEngine', () => {
  it('scores a high-match repo above 0.7', () => {
    const repo = makeMockRepo({
      full_name: 'harness/gitness',
      description: 'Self-hosted CI/CD platform with Docker support',
      stars: 30000,
      language: 'Go',
      license: { key: 'mit', name: 'MIT' },
      topics: ['ci-cd', 'docker', 'devops', 'kubernetes'],
      updated_at: new Date().toISOString(),
    });

    const readme = 'Open source CI/CD platform. Docker-native. Self-hosted pipeline automation.';
    const score = engine.scoreRepo(repo, criteria, readme, 'CI/CD platform');

    expect(score.total).toBeGreaterThan(0.7);
    expect(score.semanticMatch).toBeGreaterThan(0.5);
    expect(score.languageMatch).toBeGreaterThan(0.5);
    expect(score.licenseCompatibility).toBeGreaterThan(0.8);
  });

  it('scores a low-match repo below 0.4', () => {
    const repo = makeMockRepo({
      full_name: 'someone/game-engine',
      description: 'A 2D game engine written in Rust',
      stars: 50,
      language: 'Rust',
      license: { key: 'gpl-3.0', name: 'GPL 3.0' },
      topics: ['gamedev', 'graphics'],
      updated_at: '2020-01-01T00:00:00Z',
    });

    const score = engine.scoreRepo(repo, criteria, null, 'CI/CD platform');
    expect(score.total).toBeLessThan(0.4);
  });

  it('ranks repositories in descending order', async () => {
    const repos = [
      makeMockRepo({ id: 1, full_name: 'a/low', stars: 5, description: 'Unrelated game', language: 'Lua', updated_at: '2019-01-01T00:00:00Z' }),
      makeMockRepo({ id: 2, full_name: 'b/high', stars: 25000, description: 'Self-hosted CI/CD with Docker', language: 'Go', updated_at: new Date().toISOString() }),
      makeMockRepo({ id: 3, full_name: 'c/mid', stars: 1000, description: 'CI helper tool', language: 'Python', updated_at: '2025-01-01T00:00:00Z' }),
    ];

    const readmes = new Map<number, string | null>();
    readmes.set(2, 'Docker CI/CD platform. Self-hosted pipeline automation.');

    const ranked = await engine.rank(repos, criteria, readmes, 'CI/CD tool', 10);
    expect(ranked[0].repo.id).toBe(2);
    expect(ranked[0].score.total).toBeGreaterThan(ranked[1].score.total);
    expect(ranked[1].score.total).toBeGreaterThan(ranked[2].score.total);
  });

  it('filters out archived repos', async () => {
    const repos = [
      makeMockRepo({ id: 1, archived: true, full_name: 'a/archived' }),
      makeMockRepo({ id: 2, full_name: 'b/active' }),
    ];

    const ranked = await engine.rank(repos, criteria, new Map(), 'test', 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].repo.id).toBe(2);
  });

  it('respects maxResults limit', async () => {
    const repos = Array.from({ length: 20 }, (_, i) =>
      makeMockRepo({ id: i + 1, full_name: `org/repo-${i}`, stars: 1000 - i * 50 }),
    );
    const ranked = await engine.rank(repos, criteria, new Map(), 'test', 5);
    expect(ranked).toHaveLength(5);
  });

  it('normalizes stars correctly', async () => {
    const zeroStar = makeMockRepo({ id: 1, stars: 0, full_name: 'a/zero' });
    const hundredK = makeMockRepo({ id: 2, stars: 100000, full_name: 'a/huge' });

    const readmeStr = 'CI/CD Docker platform';
    const readmes = new Map<number, string | null>([[1, readmeStr], [2, readmeStr]]);
    const ranked = await engine.rank([zeroStar, hundredK], criteria, readmes, 'CI/CD', 10);
    expect(ranked[1].score.starsScore).toBe(0);
    expect(ranked[0].score.starsScore).toBe(1);
  });

  it('scores recently updated repos higher', async () => {
    const recent = makeMockRepo({ id: 1, full_name: 'a/recent', updated_at: new Date().toISOString() });
    const old = makeMockRepo({ id: 2, full_name: 'a/old', updated_at: '2019-01-01T00:00:00Z' });

    const readmeStr = 'CI/CD Docker tool';
    const readmes = new Map<number, string | null>([[1, readmeStr], [2, readmeStr]]);
    const ranked = await engine.rank([recent, old], criteria, readmes, 'CI/CD', 10);
    expect(ranked[0].score.activityScore).toBeGreaterThan(ranked[1].score.activityScore);
  });

  it('applies weight emphasis multipliers', () => {
    const repo = makeMockRepo({
      full_name: 'org/test',
      description: 'A test repo',
      stars: 5000,
      language: 'Go',
      license: { key: 'mit', name: 'MIT' },
      updated_at: new Date().toISOString(),
    });

    const noEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool');

    const emphasis = {
      semanticMatch: 2.0,
      starsScore: 1.0,
      activityScore: 1.0,
      readmeRelevance: 1.0,
      languageMatch: 1.0,
      licenseCompatibility: 1.0,
    };

    const withEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool', emphasis);

    // With semanticMatch emphasis at 2.0, the total should differ
    expect(withEmphasis.total).not.toBe(noEmphasis.total);
  });

  it('emphasis of 1.0 on all signals produces same scores as no emphasis', () => {
    const repo = makeMockRepo({
      full_name: 'org/test',
      description: 'A test repo',
      stars: 5000,
      language: 'Go',
      license: { key: 'mit', name: 'MIT' },
      updated_at: new Date().toISOString(),
    });

    const noEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool');

    const neutralEmphasis = {
      semanticMatch: 1.0,
      starsScore: 1.0,
      activityScore: 1.0,
      readmeRelevance: 1.0,
      languageMatch: 1.0,
      licenseCompatibility: 1.0,
    };

    const withEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool', neutralEmphasis);

    expect(withEmphasis.total).toBe(noEmphasis.total);
  });

  // ── Soft saturation tests (baseSemanticScore no longer hard-capped at 1.0) ──

  it('baseSemanticScore uses diminishing returns (soft saturation), not hard cap', () => {
    // A repo with MANY token matches should score higher than one with moderate matches.
    // Under the old Math.min(1, score) both would saturate to 1.0 — indistinguishable.
    // Under score/(1+score), the richer match should win.
    const repoWithManyMatches = makeMockRepo({
      full_name: 'org/self-hosted-ci-cd-docker',
      description: 'Self-hosted CI/CD Docker container deployment pipeline automation monitoring',
      stars: 5000,
      language: 'Go',
      topics: ['ci-cd', 'docker', 'self-hosted', 'devops', 'automation', 'monitoring'],
      updated_at: new Date().toISOString(),
    });

    const repoWithFewMatches = makeMockRepo({
      full_name: 'org/notes-app',
      description: 'A simple note-taking app',
      stars: 5000,
      language: 'Go',
      topics: ['notes'],
      updated_at: new Date().toISOString(),
    });

    const scoreMany = engine.scoreRepo(repoWithManyMatches, criteria, 'CI/CD Docker container pipeline', 'CI/CD platform');
    const scoreFew = engine.scoreRepo(repoWithFewMatches, criteria, null, 'CI/CD platform');

    expect(scoreMany.semanticMatch).toBeGreaterThan(scoreFew.semanticMatch);
    expect(scoreMany.total).toBeGreaterThan(scoreFew.total);
  });

  it('baseSemanticScore never reaches 1.0 (asymptotic)', () => {
    // Even with an extremely well-matching repo, semanticMatch should be < 1.0
    // because score/(1+score) asymptotically approaches but never reaches 1.
    const perfectRepo = makeMockRepo({
      full_name: 'org/ci-cd-docker-self-hosted-pipeline',
      description: 'CI/CD Docker self-hosted pipeline automation monitoring devops deployment',
      stars: 50000,
      language: 'Go',
      topics: ['ci-cd', 'docker', 'self-hosted', 'devops', 'automation', 'pipeline', 'monitoring', 'deployment'],
      updated_at: new Date().toISOString(),
    });

    const score = engine.scoreRepo(perfectRepo, criteria, 'CI/CD Docker self-hosted pipeline automation devops', 'CI/CD platform');
    expect(score.semanticMatch).toBeLessThan(1.0);
    // But it should still be high (> 0.5)
    expect(score.semanticMatch).toBeGreaterThan(0.5);
  });

  it('baseSemanticScore preserves ordering for incremental matches', () => {
    // Adding more keyword matches should monotonically increase the score.
    // This verifies diminishing returns don't break ordering.
    const baseRepo = makeMockRepo({
      full_name: 'org/notes',
      description: 'A simple note-taking application',
      stars: 5000,
      language: 'Go',
      topics: [],
      updated_at: new Date().toISOString(),
    });

    const criteriaMinimal: SearchCriteria = {
      keywords: ['notes'],
      technologies: [],
      intent: 'other',
      useCase: 'note app',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
    };

    const criteriaRich: SearchCriteria = {
      keywords: ['ci', 'cd', 'docker', 'self-hosted', 'pipeline', 'devops', 'automation', 'monitoring'],
      technologies: ['Go', 'Docker'],
      intent: 'devops-tool',
      useCase: 'Self-hosted CI/CD platform',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
    };

    const richRepo = makeMockRepo({
      full_name: 'org/self-hosted-ci-cd-docker',
      description: 'Self-hosted CI/CD Docker deployment pipeline automation monitoring devops',
      stars: 5000,
      language: 'Go',
      topics: ['ci-cd', 'docker', 'self-hosted', 'devops', 'automation', 'pipeline', 'monitoring'],
      updated_at: new Date().toISOString(),
    });

    const minimalScore = engine.scoreRepo(baseRepo, criteriaMinimal, null, 'note app');
    const richScore = engine.scoreRepo(richRepo, criteriaRich, 'CI/CD Docker pipeline', 'CI/CD platform');

    expect(richScore.semanticMatch).toBeGreaterThan(minimalScore.semanticMatch);
  });
});

// ── Vietnamese criteria ranking ──

describe('RankingEngine with Vietnamese criteria', () => {
  it('scores repos higher when English translation matches', () => {
    const viCriteria: SearchCriteria = {
      keywords: ['quản lý', 'mật khẩu'],
      technologies: [],
      intent: 'password-manager',
      useCase: 'quản lý mật khẩu',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      englishTranslation: 'password manager',
      technicalConcepts: ['password-manager', 'credential'],
      originalQuery: 'quản lý mật khẩu',
    };

    const repo = makeMockRepo({
      full_name: 'vault/vault',
      description: 'A password manager for credentials and secrets',
      stars: 30000,
      language: 'Go',
      license: { key: 'mpl-2.0', name: 'MPL 2.0' },
      topics: ['password', 'vault', 'credentials', 'secret-management'],
      updated_at: new Date().toISOString(),
    });

    const score = engine.scoreRepo(repo, viCriteria, 'Password manager and credential vault', 'quản lý mật khẩu');

    // English translation tokens should boost the score
    expect(score.semanticMatch).toBeGreaterThan(0.3);
    expect(score.total).toBeGreaterThan(0.5);
  });

  it('boosts repos whose topics overlap with intent cluster', () => {
    const viCriteria: SearchCriteria = {
      keywords: ['monitoring', 'server'],
      technologies: [],
      intent: 'monitoring',
      useCase: 'công cụ giám sát máy chủ',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      englishTranslation: 'server monitoring tool',
      technicalConcepts: ['monitoring', 'observability'],
      originalQuery: 'công cụ giám sát máy chủ',
    };

    const repoWithTopics = makeMockRepo({
      full_name: 'prometheus/prometheus',
      description: 'Monitoring and observability platform',
      stars: 50000,
      language: 'Go',
      topics: ['monitoring', 'observability', 'alerting', 'metrics'],
      updated_at: new Date().toISOString(),
    });

    const repoWithoutTopics = makeMockRepo({
      full_name: 'random/tool',
      description: 'A monitoring tool',
      stars: 50000,
      language: 'Go',
      topics: [],
      updated_at: new Date().toISOString(),
    });

    const scoreWith = engine.scoreRepo(repoWithTopics, viCriteria, null, 'công cụ giám sát máy chủ');
    const scoreWithout = engine.scoreRepo(repoWithoutTopics, viCriteria, null, 'công cụ giám sát máy chủ');

    // Repo with matching intent topics should score higher
    expect(scoreWith.total).toBeGreaterThan(scoreWithout.total);
  });

  it('uses technicalConcepts to boost semantic matching', () => {
    const baseCriteria: SearchCriteria = {
      keywords: ['tool'],
      technologies: [],
      intent: 'other',
      useCase: 'tool',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
    };

    const viCriteria: SearchCriteria = {
      ...baseCriteria,
      technicalConcepts: ['ci-cd', 'containerization'],
      englishTranslation: 'CI/CD containerization tool',
    };

    const repo = makeMockRepo({
      full_name: 'org/ci-tool',
      description: 'CI/CD containerization platform for Docker',
      stars: 5000,
      topics: ['ci-cd', 'containerization', 'docker'],
      updated_at: new Date().toISOString(),
    });

    const baseScore = engine.scoreRepo(repo, baseCriteria, null, 'tool');
    const viScore = engine.scoreRepo(repo, viCriteria, null, 'CI/CD containerization tool');

    // Vietnamese criteria with tech concepts should score higher
    expect(viScore.semanticMatch).toBeGreaterThan(baseScore.semanticMatch);
  });

  it('expanded keywords flow into buildSearchParamsArray', () => {
    // Verify SearchCriteria with expandedKeywords produces more search params
    const criteria: SearchCriteria = {
      keywords: ['monitoring', 'server'],
      technologies: [],
      intent: 'monitoring',
      useCase: 'giám sát máy chủ',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      englishTranslation: 'server monitoring tool',
      expandedKeywords: ['observability', 'watch', 'server', 'host'],
      originalQuery: 'giám sát máy chủ',
    };

    const qg = new QueryGenerator({} as any, 'test-model');
    const params = qg.buildSearchParamsArray(criteria);

    // Should have queries for keywords + expanded keywords (sans duplicates)
    expect(params.length).toBeGreaterThan(2);
    // At least one expanded keyword query should appear
    const expandedQueries = params.map((p: { query: string }) => p.query.toLowerCase());
    const hasExpanded = expandedQueries.some((q: string) =>
      q === 'observability' || q === 'watch' || q === 'host',
    );
    expect(hasExpanded).toBe(true);
  });

  // ── Intent-topic cluster alignment for Vietnamese intents ──

  it('boosts repos with networking topics when intent is networking-tool', () => {
    const viCriteria: SearchCriteria = {
      keywords: ['networking', 'proxy'],
      technologies: [],
      intent: 'networking-tool',
      useCase: 'công cụ mạng proxy',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      englishTranslation: 'networking proxy tool',
      technicalConcepts: ['proxy', 'gateway'],
      originalQuery: 'công cụ mạng proxy',
    };

    const repoWithTopics = makeMockRepo({
      full_name: 'traefik/traefik',
      description: 'HTTP reverse proxy and load balancer',
      stars: 50000,
      language: 'Go',
      topics: ['proxy', 'gateway', 'networking', 'load-balancer', 'dns'],
      updated_at: new Date().toISOString(),
    });

    const repoWithoutTopics = makeMockRepo({
      full_name: 'random/tool',
      description: 'A generic networking tool',
      stars: 50000,
      language: 'Go',
      topics: [],
      updated_at: new Date().toISOString(),
    });

    const scoreWith = engine.scoreRepo(repoWithTopics, viCriteria, null, 'networking proxy tool');
    const scoreWithout = engine.scoreRepo(repoWithoutTopics, viCriteria, null, 'networking proxy tool');

    // Intent-topic alignment should give higher semantic match to the repo with matching topics
    expect(scoreWith.semanticMatch).toBeGreaterThan(scoreWithout.semanticMatch);
  });

  it('boosts repos with authentication topics when intent is authentication', () => {
    const viCriteria: SearchCriteria = {
      keywords: ['authentication', 'login'],
      technologies: [],
      intent: 'authentication',
      useCase: 'đăng nhập người dùng',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      englishTranslation: 'user authentication login',
      technicalConcepts: ['authentication', 'oauth'],
      originalQuery: 'đăng nhập',
    };

    const repoWithTopics = makeMockRepo({
      full_name: 'authelia/authelia',
      description: 'Authentication and SSO server',
      stars: 20000,
      language: 'Go',
      topics: ['authentication', 'oauth', 'sso', 'identity'],
      updated_at: new Date().toISOString(),
    });

    const repoWithoutTopics = makeMockRepo({
      full_name: 'random/auth',
      description: 'An auth tool',
      stars: 20000,
      language: 'Go',
      topics: [],
      updated_at: new Date().toISOString(),
    });

    const scoreWith = engine.scoreRepo(repoWithTopics, viCriteria, null, 'authentication login');
    const scoreWithout = engine.scoreRepo(repoWithoutTopics, viCriteria, null, 'authentication login');

    expect(scoreWith.total).toBeGreaterThan(scoreWithout.total);
  });

  it('soft saturation prevents score indistinguishability for Vietnamese expanded queries', () => {
    // Vietnamese query with many expanded keywords should produce distinct
    // semantic scores for well-matching vs poorly-matching repos.
    // Under the old Math.min(1, score) cap, both would saturate to 1.0.
    const viCriteria: SearchCriteria = {
      keywords: ['monitoring', 'server', 'host'],
      technologies: [],
      intent: 'monitoring',
      useCase: 'giám sát máy chủ',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      englishTranslation: 'server monitoring tool',
      technicalConcepts: ['monitoring', 'observability'],
      expandedKeywords: ['observability', 'watch', 'server', 'host'],
      originalQuery: 'giám sát máy chủ',
    };

    const wellMatched = makeMockRepo({
      full_name: 'prometheus/prometheus',
      description: 'Monitoring and observability platform for servers and hosts',
      stars: 50000,
      language: 'Go',
      topics: ['monitoring', 'observability', 'alerting', 'metrics'],
      updated_at: new Date().toISOString(),
    });

    const poorlyMatched = makeMockRepo({
      full_name: 'some/notes-app',
      description: 'A note-taking app',
      stars: 50000,
      language: 'Go',
      topics: ['notes'],
      updated_at: new Date().toISOString(),
    });

    const wellScore = engine.scoreRepo(wellMatched, viCriteria, null, 'giám sát máy chủ');
    const poorScore = engine.scoreRepo(poorlyMatched, viCriteria, null, 'giám sát máy chủ');

    // With soft saturation, both scores should be distinct and well-matched should win
    expect(wellScore.semanticMatch).toBeGreaterThan(poorScore.semanticMatch);
    // Neither should be exactly 1.0
    expect(wellScore.semanticMatch).toBeLessThan(1.0);
    expect(poorScore.semanticMatch).toBeLessThan(1.0);
  });

  // ── expandedKeywords boosting ──
  describe('expandedKeywords boosting', () => {
    it('boosts repos whose description matches expandedKeywords', () => {
      const viWithExpanded: SearchCriteria = {
        keywords: ['monitoring'],
        technologies: [],
        intent: 'monitoring',
        useCase: 'giám sát máy chủ',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        englishTranslation: 'server monitoring tool',
        technicalConcepts: ['monitoring'],
        expandedKeywords: ['observability', 'watch'],
        originalQuery: 'giám sát máy chủ',
      };
      const viWithoutExpanded: SearchCriteria = {
        ...viWithExpanded,
        expandedKeywords: undefined,
      };

      const repo = makeMockRepo({
        full_name: 'prometheus/prometheus',
        description: 'Observability and monitoring platform with watch capabilities',
        stars: 50000,
        language: 'Go',
        topics: ['monitoring', 'observability'],
        updated_at: new Date().toISOString(),
      });

      const scoreWith = engine.scoreRepo(repo, viWithExpanded, null, 'giám sát');
      const scoreWithout = engine.scoreRepo(repo, viWithoutExpanded, null, 'giám sát');

      // Repo should score higher when expanded keywords match
      expect(scoreWith.total).toBeGreaterThan(scoreWithout.total);
    });

    it('boosts repos whose fullName matches expandedKeywords', () => {
      const viWithExpanded: SearchCriteria = {
        keywords: ['management'],
        technologies: [],
        intent: 'password-manager',
        useCase: 'quản lý mật khẩu',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        englishTranslation: 'password management',
        technicalConcepts: ['password', 'credential'],
        expandedKeywords: ['manager', 'admin'],
        originalQuery: 'quản lý mật khẩu',
      };

      const repo = makeMockRepo({
        full_name: 'vault/password-manager',
        description: 'A password management tool',
        stars: 5000,
        language: 'TypeScript',
        topics: ['password', 'security'],
        updated_at: new Date().toISOString(),
      });

      const scoreWith = engine.scoreRepo(repo, viWithExpanded, null, 'quản lý mật khẩu');
      expect(scoreWith.semanticMatch).toBeGreaterThan(0.3);
    });

    it('does not boost when expandedKeywords is empty or undefined', () => {
      const criteria1: SearchCriteria = {
        ...criteria,
        expandedKeywords: [],
      };
      const criteria2: SearchCriteria = {
        ...criteria,
        expandedKeywords: undefined,
      };

      const repo = makeMockRepo({
        full_name: 'harness/gitness',
        description: 'Self-hosted CI/CD platform with Docker support',
        stars: 30000,
        language: 'Go',
        license: { key: 'mit', name: 'MIT' },
        topics: ['ci-cd', 'docker', 'devops'],
        updated_at: new Date().toISOString(),
      });

      const s1 = engine.scoreRepo(repo, criteria1, 'CI/CD platform', 'CI/CD');
      const s2 = engine.scoreRepo(repo, criteria2, 'CI/CD platform', 'CI/CD');
      expect(s1.total).toBe(s2.total);
    });
  });

  // ── Vietnamese original query diacritics matching ──
  describe('Vietnamese original query diacritics matching', () => {
    it('boosts repos whose full_name contains diacritics-stripped Vietnamese slug', () => {
      const viCriteria: SearchCriteria = {
        keywords: ['password manager'],
        technologies: [],
        intent: 'password-manager',
        useCase: 'quản lý mật khẩu',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'quản lý mật khẩu',
        englishTranslation: 'password manager',
        expandedKeywords: ['password', 'manager'],
      };

      // Repo with diacritics-stripped Vietnamese in slug
      const repo = makeMockRepo({
        full_name: 'vn/quan-ly-mat-khau',
        description: 'Password manager tool',
        stars: 500,
        topics: ['password', 'security'],
        updated_at: new Date().toISOString(),
      });

      const score = engine.scoreRepo(repo, viCriteria, null, 'password manager');
      // Should get a boost from matching "quan-ly-mat-khau" against originalQuery
      expect(score.total).toBeGreaterThan(0);
      // The boost should come from Vietnamese original query matching
      expect(score.semanticMatch).toBeGreaterThan(0.01);
    });

    it('boosts repos whose description contains Vietnamese keyword directly', () => {
      const viCriteria: SearchCriteria = {
        keywords: ['monitoring'],
        technologies: [],
        intent: 'devops-tool',
        useCase: 'giám sát hệ thống',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'giám sát hệ thống',
        englishTranslation: 'system monitoring',
        expandedKeywords: ['monitoring', 'observability'],
      };

      const repo = makeMockRepo({
        full_name: 'vn/monitoring-tool',
        description: 'Công cụ giám sát máy chủ và hệ thống',
        stars: 500,
        topics: ['monitoring', 'devops'],
        updated_at: new Date().toISOString(),
      });

      const score = engine.scoreRepo(repo, viCriteria, null, 'monitoring');
      expect(score.semanticMatch).toBeGreaterThan(0.01);
    });

    it('does not boost when originalQuery is undefined (non-Vietnamese)', () => {
      const enCriteria: SearchCriteria = {
        keywords: ['password manager'],
        technologies: [],
        intent: 'password-manager',
        useCase: 'password manager',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      };

      const repo = makeMockRepo({
        full_name: 'vn/quan-ly-mat-khau',
        description: 'Password manager tool',
        stars: 500,
        topics: ['password'],
        updated_at: new Date().toISOString(),
      });

      // No Vietnamese original query → no diacritics boost
      const score = engine.scoreRepo(repo, enCriteria, null, 'password manager');
      // Score should still work, just without Vietnamese boost
      expect(score.total).toBeGreaterThan(0);
    });

    it('strips đ correctly (đ → d)', () => {
      const viCriteria: SearchCriteria = {
        keywords: ['logging'],
        technologies: [],
        intent: 'devops-tool',
        useCase: 'đăng nhập',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'đăng nhập',
        englishTranslation: 'login',
        expandedKeywords: ['login', 'auth'],
      };

      const repo = makeMockRepo({
        full_name: 'vn/dang-nhap-auth',
        description: 'Authentication module',
        stars: 200,
        topics: ['auth', 'login'],
        updated_at: new Date().toISOString(),
      });

      const score = engine.scoreRepo(repo, viCriteria, null, 'login');
      // "đăng" → "dang" should match "dang" in full_name
      expect(score.semanticMatch).toBeGreaterThan(0.01);
    });
  });

  // ── Vietnamese-aware useCase decomposition ──

  describe('Vietnamese-aware useCase decomposition', () => {
    it('boosts repos when englishTranslation sub-phrases match description', () => {
      const viCriteria: SearchCriteria = {
        keywords: ['project management'],
        technologies: [],
        intent: 'web-app',
        useCase: 'quản lý dự án kanban',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'quản lý dự án kanban',
        englishTranslation: 'project management kanban tool',
        expandedKeywords: ['project-management', 'kanban', 'task'],
      };

      const repo = makeMockRepo({
        full_name: 'wekan/wekan',
        description: 'Open source kanban board for project management',
        stars: 5000,
        topics: ['kanban', 'project-management'],
        updated_at: new Date().toISOString(),
      });

      const score = engine.scoreRepo(repo, viCriteria, null, 'project management kanban');
      // The englishTranslation "project management" should directly match in description
      expect(score.semanticMatch).toBeGreaterThan(0.05);
    });

    it('boosts repos when englishTranslation 2-word sub-phrases match description', () => {
      const viCriteria: SearchCriteria = {
        keywords: ['data visualization'],
        technologies: [],
        intent: 'library',
        useCase: 'trực quan dữ liệu',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'trực quan dữ liệu',
        englishTranslation: 'data visualization library',
        expandedKeywords: ['visualization', 'dashboard', 'charting'],
      };

      const repo = makeMockRepo({
        full_name: 'apache/echarts',
        description: 'A powerful charting library for data visualization',
        stars: 60000,
        topics: ['visualization', 'charting', 'data'],
        updated_at: new Date().toISOString(),
      });

      const score = engine.scoreRepo(repo, viCriteria, null, 'data visualization');
      // "data visualization" in englishTranslation should match description
      expect(score.semanticMatch).toBeGreaterThan(0.05);
    });

    it('does not double-boost when englishTranslation matches a token already scored', () => {
      // If the englishTranslation "password manager" is already matched as a keyword token,
      // the Vietnamese-aware decomposition should add minimal extra boost
      const viCriteria: SearchCriteria = {
        keywords: ['password manager'],
        technologies: [],
        intent: 'password-manager',
        useCase: 'quản lý mật khẩu',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
        originalQuery: 'quản lý mật khẩu',
        englishTranslation: 'password manager',
        expandedKeywords: ['credential', 'vault'],
      };

      const enCriteria: SearchCriteria = {
        keywords: ['password manager'],
        technologies: [],
        intent: 'password-manager',
        useCase: 'password manager',
        minStars: 0,
        preferredLicense: null,
        requireRecentActivity: false,
      };

      const repo = makeMockRepo({
        full_name: 'vault/vault',
        description: 'A tool for managing secrets and passwords',
        stars: 30000,
        topics: ['password', 'secrets'],
        updated_at: new Date().toISOString(),
      });

      const viScore = engine.scoreRepo(repo, viCriteria, null, 'password manager');
      const enScore = engine.scoreRepo(repo, enCriteria, null, 'password manager');

      // Vietnamese criteria should score at least as well as English-only
      expect(viScore.semanticMatch).toBeGreaterThanOrEqual(enScore.semanticMatch);
    });
  });
});
