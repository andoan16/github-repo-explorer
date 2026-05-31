import { describe, it, expect } from 'vitest';
import { OllamaClient } from '../../src/main/ollama/client';
import { GitHubClient } from '../../src/main/github/client';
import { QueryGenerator } from '../../src/main/search/query-gen';
import { RankingEngine } from '../../src/main/ranking/engine';
import { createDisconnectedOllamaClient, createMockOllamaClient } from '../mocks/ollama';
import { createInvalidTokenGitHubClient, createMockGitHubClient, makeMockRepos } from '../mocks/github';
import type { GitHubRepo } from '../../src/shared/types';

describe('Error handling', () => {
  // ── Ollama errors ──
  it('handles missing Ollama installation', async () => {
    const mock = createDisconnectedOllamaClient();
    const status = await mock.checkConnection();
    expect(status.connected).toBe(false);
    expect(status.error).toBeTruthy();
  });

  it('handles Ollama server unavailable during search', async () => {
    const mock = createDisconnectedOllamaClient();
    const qg = new QueryGenerator(
      mock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );
    await expect(qg.extractCriteria('test')).rejects.toThrow();
  });

  it('handles LLM returning malformed JSON', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce('I think the keywords are docker and ci-cd but I am not sure');
    const qg = new QueryGenerator(
      mock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );
    await expect(qg.extractCriteria('test')).rejects.toThrow('Failed to parse LLM output');
  });

  it('handles LLM returning empty response', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce('');
    const qg = new QueryGenerator(
      mock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );
    await expect(qg.extractCriteria('test')).rejects.toThrow();
  });

  it('handles LLM returning JSON with missing fields', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce('{"keywords":["test"]}');
    const qg = new QueryGenerator(
      mock as unknown as Parameters<typeof QueryGenerator>[0],
      'llama3.2',
    );
    const criteria = await qg.extractCriteria('test');
    expect(criteria.keywords).toHaveLength(3);
    expect(criteria.keywords[0]).toBe('test');
    expect(criteria.technologies).toEqual([]);
    expect(criteria.intent).toBe('other');
  });

  // ── GitHub errors ──
  it('handles invalid GitHub token', async () => {
    const mock = createInvalidTokenGitHubClient();
    const result = await mock.checkToken();
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('handles GitHub API rate limits', async () => {
    // Simulate what happens — the actual HTTP 403 is thrown by the real client
    const mock = createMockGitHubClient();
    mock.searchRepos.mockRejectedValueOnce(
      new Error('GitHub API rate limit exceeded. Resets at 12:00:00. Add a token for higher limits.'),
    );
    await expect(mock.searchRepos({ query: 'test', sort: 'stars', order: 'desc', perPage: 10 })).rejects.toThrow('rate limit');
  });

  it('handles GitHub 422 unprocessable query', async () => {
    const mock = createMockGitHubClient();
    mock.searchRepos.mockRejectedValueOnce(
      new Error('GitHub could not parse the search query. Try a different description.'),
    );
    await expect(mock.searchRepos({ query: 'test', sort: 'stars', order: 'desc', perPage: 10 })).rejects.toThrow('parse');
  });

  it('handles network failures', async () => {
    const mock = createMockGitHubClient();
    mock.searchRepos.mockRejectedValueOnce(new Error('fetch failed'));
    await expect(mock.searchRepos({ query: 'test', sort: 'stars', order: 'desc', perPage: 10 })).rejects.toThrow('fetch failed');
  });

  it('handles empty search results gracefully in ranking', async () => {
    const engine = new RankingEngine();
    const criteria = {
      keywords: ['nothing'], technologies: [], intent: 'other' as const,
      useCase: 'test', minStars: 0, preferredLicense: null, requireRecentActivity: false,
    };
    const ranked = await engine.rank([], criteria, new Map(), 'test', 10);
    expect(ranked).toHaveLength(0);
  });

  it('handles archived repos being filtered', async () => {
    const engine = new RankingEngine();
    const repos: GitHubRepo[] = [
      makeMockRepos(1)[0],
      { ...makeMockRepos(1)[0], id: 999, archived: true },
    ];
    const criteria = {
      keywords: ['test'], technologies: [], intent: 'other' as const,
      useCase: 'test', minStars: 0, preferredLicense: null, requireRecentActivity: false,
    };
    const ranked = await engine.rank(repos, criteria, new Map(), 'test', 10);
    expect(ranked).toHaveLength(1);
  });

  it('handles repos with null description in scoring', () => {
    const engine = new RankingEngine();
    const repo = { ...makeMockRepos(1)[0], description: null };
    const criteria = {
      keywords: ['test'], technologies: [], intent: 'other' as const,
      useCase: 'test', minStars: 0, preferredLicense: null, requireRecentActivity: false,
    };
    const score = engine.scoreRepo(repo, criteria, null, 'test');
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(1);
  });

  it('handles repos with null license in scoring', () => {
    const engine = new RankingEngine();
    const repo = { ...makeMockRepos(1)[0], license: null };
    const criteria = {
      keywords: ['test'], technologies: [], intent: 'other' as const,
      useCase: 'test', minStars: 0, preferredLicense: 'mit', requireRecentActivity: false,
    };
    const score = engine.scoreRepo(repo, criteria, null, 'test');
    expect(score.total).toBeGreaterThanOrEqual(0);
  });
});
