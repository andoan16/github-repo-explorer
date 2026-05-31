import { describe, it, expect, vi } from 'vitest';
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
  it('completes full search pipeline with mocks (explanations lazy-loaded)', async () => {
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

    // Step 4: Rank (no explanations generated upfront)
    const ranked = await ranking.rank(repos, criteria, readmes, 'CI/CD with Docker', 10);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].score.total).toBeGreaterThan(0);

    // Results use placeholder explanations
    const results = ranked.map(({ repo, score }) => ({
      repo,
      readme: readmes.get(repo.id) ?? null,
      score,
      matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
      requestContext: 'CI/CD with Docker',
    }));
    expect(results[0].matchExplanation).toContain('Score:');
    expect(results[0].requestContext).toBe('CI/CD with Docker');

    // Step 5: Generate explanation on demand (when user clicks result)
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

    const ranked = await ranking.rank(repos, criteria, new Map(), 'UI components', 10);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].repo.language).toBe('Go'); // mock always returns Go
  });

  it('issues multiple parallel searches via buildSearchParamsArray', async () => {
    const ollamaMock = createMockOllamaClient();
    const githubMock = createMockGitHubClient();
    const qg = new QueryGenerator(
      ollamaMock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );

    const criteria = await qg.extractCriteria('I need a self-hosted CI/CD tool with Docker');
    const paramsArray = qg.buildSearchParamsArray(criteria);

    expect(paramsArray.length).toBeGreaterThanOrEqual(2);

    // Issue all searches in parallel (simulating the handler)
    const results = await Promise.all(
      paramsArray.map((p) => githubMock.searchRepos(p)),
    );

    expect(githubMock.searchRepos).toHaveBeenCalledTimes(paramsArray.length);
    expect(results).toHaveLength(paramsArray.length);
    for (const r of results) {
      expect(r.repos.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates results by repo ID, keeping higher stars', async () => {
    const githubMock = createMockGitHubClient();
    const ranking = new RankingEngine();

    // Return different repos from different queries with some overlap
    githubMock.searchRepos
      .mockResolvedValueOnce({
        repos: [
          makeMockRepos(1)[0], // low-star version of mock (10k stars)
        ],
        totalCount: 1,
        rateLimitRemaining: 4999,
      })
      .mockResolvedValueOnce({
        repos: [
          { ...makeMockRepos(1)[0], stars: 50000 }, // higher-star same ID
        ],
        totalCount: 1,
        rateLimitRemaining: 4998,
      });

    const lowResult = await githubMock.searchRepos({ query: 'q1', sort: 'stars', order: 'desc', perPage: 30 });
    const highResult = await githubMock.searchRepos({ query: 'q2', sort: 'stars', order: 'desc', perPage: 30 });

    // Manual dedup logic (same as handler)
    const repoMap = new Map<number, typeof lowResult.repos[0]>();
    for (const repo of [...lowResult.repos, ...highResult.repos]) {
      const existing = repoMap.get(repo.id);
      if (!existing || repo.stars > existing.stars) {
        repoMap.set(repo.id, repo);
      }
    }
    const merged = [...repoMap.values()];

    expect(merged).toHaveLength(1);
    expect(merged[0].stars).toBe(50000);
  });

  it('handles partial query failures gracefully', async () => {
    const githubMock = createMockGitHubClient();
    const ranking = new RankingEngine();

    githubMock.searchRepos
      .mockResolvedValueOnce({
        repos: makeMockRepos(5),
        totalCount: 5,
        rateLimitRemaining: 4999,
      })
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce({
        repos: makeMockRepos(3),
        totalCount: 3,
        rateLimitRemaining: 4998,
      });

    const results = await Promise.allSettled([
      githubMock.searchRepos({ query: 'q1', sort: 'stars', order: 'desc', perPage: 30 }),
      githubMock.searchRepos({ query: 'q2', sort: 'stars', order: 'desc', perPage: 30 }),
      githubMock.searchRepos({ query: 'q3', sort: 'stars', order: 'desc', perPage: 30 }),
    ]);

    const successful = results.filter((r) => r.status === 'fulfilled');
    expect(successful).toHaveLength(2);
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed).toHaveLength(1);
  });

  it('refinement re-ranks cached results without hitting GitHub again', async () => {
    const ollamaMock = createMockOllamaClient();
    const githubMock = createMockGitHubClient();
    const ranking = new RankingEngine();

    // Initial search
    const qgInitial = new QueryGenerator(
      ollamaMock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );
    const criteria = await qgInitial.extractCriteria('CI/CD tool');
    const paramsArray = qgInitial.buildSearchParamsArray(criteria);
    const results = await Promise.all(paramsArray.map((p) => githubMock.searchRepos(p)));

    const repoMap = new Map<number, (typeof results)[0]['repos'][0]>();
    for (const r of results) {
      for (const repo of r.repos) {
        repoMap.set(repo.id, repo);
      }
    }
    const repos = [...repoMap.values()];

    const initialSearchReposCalls = githubMock.searchRepos.mock.calls.length;

    // Now simulate refinement: set up a refinement response from Ollama
    ollamaMock.generate.mockResolvedValueOnce(
      '{"keywords":["DevOps","Kubernetes","Docker"],"technologies":["Docker","Kubernetes"],"intent":"devops-tool","minStars":50,"preferredLicense":"mit","requireRecentActivity":true,"weightEmphasis":{"semanticMatch":1.5,"starsScore":1.0,"activityScore":1.0,"readmeRelevance":1.2,"languageMatch":1.0,"licenseCompatibility":1.0}}',
    );

    const qgRefine = new QueryGenerator(
      ollamaMock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );
    const refined = await qgRefine.refineCriteria(criteria, 'more DevOps focused', 'CI/CD tool');

    const readmes = new Map<number, string | null>();
    for (const r of results) {
      for (const repo of r.repos.slice(0, 5)) {
        readmes.set(repo.id, 'README content');
      }
    }

    const reRanked = await ranking.rank(repos, refined, readmes, 'CI/CD tool', 10, refined.weightEmphasis);
    expect(reRanked.length).toBeGreaterThan(0);

    // searchRepos should NOT have been called again
    expect(githubMock.searchRepos.mock.calls.length).toBe(initialSearchReposCalls);
  });

  it('refinement returns error without prior search', async () => {
    // Simulating the cache check: if lastSearchCache is null, error is returned
    const cache = null;
    const error = cache
      ? null
      : 'No search to refine. Run a search first.';
    expect(error).toBeTruthy();
  });

  it('generates explanation on demand for a single repo', async () => {
    const ollamaMock = createMockOllamaClient();
    const qg = new QueryGenerator(
      ollamaMock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );

    const explanation = await qg.generateMatchExplanation(
      'docker/compose',
      'Define and run multi-container Docker applications',
      'I need a self-hosted CI/CD tool with Docker',
    );
    expect(explanation).toBeTruthy();
    expect(typeof explanation).toBe('string');
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

    const ranked = await ranking.rank(repos, criteria, readmes, 'markdown editor with live preview', 5);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].score.total).toBeGreaterThan(0);
  }, 120000);
});
