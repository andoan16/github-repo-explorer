import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaClient } from '../../src/main/ollama/client';
import { GitHubClient } from '../../src/main/github/client';
import { QueryGenerator } from '../../src/main/search/query-gen';
import { RankingEngine } from '../../src/main/ranking/engine';
import { createMockOllamaClient, createDisconnectedOllamaClient } from '../mocks/ollama';
import { createMockGitHubClient, createInvalidTokenGitHubClient, makeMockRepos } from '../mocks/github';
import type { SearchFilters } from '../../src/shared/types';

const USE_LIVE = process.env.RUN_INTEGRATION_TESTS === 'true' &&
  process.env.OLLAMA_TEST_URL &&
  process.env.GITHUB_TEST_TOKEN;

describe('End-to-end search flow', () => {
  it('completes full search pipeline with mocks', async () => {
    const ollamaMock = createMockOllamaClient();
    const githubMock = createMockGitHubClient();
    const ranking = new RankingEngine();

    const qg = new QueryGenerator(
      ollamaMock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );

    // Step 1: Extract criteria
    const criteria = await qg.extractCriteria('I need a self-hosted CI/CD tool with Docker');
    expect(criteria.keywords.length).toBeGreaterThan(0);

    // Step 2: Build params & search
    const params = qg.buildSearchParams(criteria);
    const { repos } = await githubMock.searchRepos(params);
    expect(repos.length).toBeGreaterThan(0);

    // Step 3: Get READMEs
    const readmes = new Map<number, string | null>();
    for (const repo of repos.slice(0, 5)) {
      const [owner, name] = repo.full_name.split('/');
      const readme = await githubMock.getReadme(owner, name, repo.default_branch);
      readmes.set(repo.id, readme);
    }

    // Step 4: Rank
    const ranked = ranking.rank(repos, criteria, readmes, 'CI/CD with Docker', 10);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].score.total).toBeGreaterThan(0);

    // Step 5: Generate explanations
    const explanation = await qg.generateMatchExplanation(
      ranked[0].repo.full_name,
      ranked[0].repo.description,
      'CI/CD with Docker',
    );
    expect(explanation).toBeTruthy();
  });

  it('handles empty search results gracefully', async () => {
    const ollamaMock = createMockOllamaClient();
    const githubMock = createMockGitHubClient();
    githubMock.searchRepos.mockResolvedValueOnce({
      repos: [],
      totalCount: 0,
      rateLimitRemaining: 4500,
    });

    const { repos } = await githubMock.searchRepos({ query: 'nonexistent', sort: 'stars', order: 'desc', perPage: 10 });
    expect(repos).toHaveLength(0);
  });

  it('handles multiple filter combinations', async () => {
    const githubMock = createMockGitHubClient();
    const ranking = new RankingEngine();

    const criteria = {
      keywords: ['react', 'ui', 'components'],
      technologies: ['TypeScript', 'React'],
      intent: 'library' as const,
      useCase: 'UI component library',
      minStars: 100,
      preferredLicense: 'mit' as const,
      requireRecentActivity: true,
    };

    const filters: SearchFilters = {
      language: 'typescript',
      license: 'mit',
      minStars: 100,
      maxAgeMonths: 12,
    };

    const params: Parameters<typeof githubMock.searchRepos>[0] = {
      query: criteria.keywords.join(' '),
      language: filters.language ?? undefined,
      minStars: filters.minStars,
      license: filters.license ?? undefined,
      sort: 'stars',
      order: 'desc',
      perPage: 30,
    };

    const { repos } = await githubMock.searchRepos(params);
    expect(repos.length).toBeGreaterThan(0);

    const ranked = ranking.rank(repos, criteria, new Map(), 'UI components', 10);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].repo.language).toBe('Go'); // mock always returns Go
  });

  it('live E2E: searches GitHub with real Ollama', async () => {
    if (!USE_LIVE) return;

    const ollama = new OllamaClient(process.env.OLLAMA_TEST_URL!);
    const github = new GitHubClient(process.env.GITHUB_TEST_TOKEN!);
    const ranking = new RankingEngine();

    const models = await ollama.listModels();
    const model = models[0]?.name ?? 'llama3.2';

    const qg = new QueryGenerator(ollama, model);

    const criteria = await qg.extractCriteria('open source markdown editor with live preview');
    const params = qg.buildSearchParams(criteria);

    const { repos } = await github.searchRepos(params);
    expect(repos.length).toBeGreaterThan(0);

    const readmes = new Map<number, string | null>();
    await Promise.all(repos.slice(0, 3).map(async (repo) => {
      const [owner, name] = repo.full_name.split('/');
      readmes.set(repo.id, await github.getReadme(owner, name, repo.default_branch));
    }));

    const ranked = ranking.rank(repos, criteria, readmes, 'markdown editor with live preview', 5);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].score.total).toBeGreaterThan(0);
  }, 120000);
});
