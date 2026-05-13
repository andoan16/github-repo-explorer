import { describe, it, expect } from 'vitest';
import { GitHubClient } from '../../src/main/github/client';
import { createMockGitHubClient, createInvalidTokenGitHubClient, makeMockRepos } from '../mocks/github';
import type { SearchParams } from '../../src/shared/types';

const USE_LIVE = process.env.RUN_INTEGRATION_TESTS === 'true' && process.env.GITHUB_TEST_TOKEN;

describe('GitHubClient (integration)', () => {
  it('validates a good token', async () => {
    if (USE_LIVE) {
      const client = new GitHubClient(process.env.GITHUB_TEST_TOKEN!);
      const result = await client.checkToken();
      expect(result.valid).toBe(true);
      expect(result.user).toBeTruthy();
    } else {
      const mock = createMockGitHubClient();
      const result = await mock.checkToken();
      expect(result.valid).toBe(true);
      expect(result.user).toBe('testuser');
    }
  });

  it('detects an invalid token', async () => {
    const mock = createInvalidTokenGitHubClient();
    const result = await mock.checkToken();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('detects missing token', async () => {
    const client = new GitHubClient('');
    const result = await client.checkToken();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No token');
  });

  it('searches repositories', async () => {
    if (USE_LIVE) {
      const client = new GitHubClient(process.env.GITHUB_TEST_TOKEN!);
      const params: SearchParams = {
        query: 'docker ci cd pipeline',
        sort: 'stars',
        order: 'desc',
        perPage: 10,
      };
      const { repos, totalCount } = await client.searchRepos(params);
      expect(repos.length).toBeGreaterThan(0);
      expect(repos.length).toBeLessThanOrEqual(10);
      expect(totalCount).toBeGreaterThan(0);
      expect(repos[0]).toHaveProperty('full_name');
      expect(repos[0]).toHaveProperty('stars');
    } else {
      const mock = createMockGitHubClient();
      const { repos, totalCount, rateLimitRemaining } = await mock.searchRepos({
        query: 'test', sort: 'stars', order: 'desc', perPage: 10,
      });
      expect(repos).toHaveLength(15);
      expect(totalCount).toBe(15);
      expect(rateLimitRemaining).toBe(4500);
    }
  });

  it('fetches README content', async () => {
    if (USE_LIVE) {
      const client = new GitHubClient(process.env.GITHUB_TEST_TOKEN!);
      const readme = await client.getReadme('facebook', 'react', 'main');
      expect(readme).toBeTruthy();
      expect(readme!.length).toBeGreaterThan(100);
    } else {
      const mock = createMockGitHubClient();
      const readme = await mock.getReadme('org', 'repo', 'main');
      expect(readme).toContain('CI/CD');
      expect(readme).toContain('# Test Repository');
    }
  });

  it('returns null for missing README', async () => {
    if (USE_LIVE) {
      const client = new GitHubClient(process.env.GITHUB_TEST_TOKEN!);
      const readme = await client.getReadme('some-org', 'definitely-does-not-exist-xyz', 'main');
      expect(readme).toBeNull();
    }
  });

  it('handles rate limit info in search response', async () => {
    const mock = createMockGitHubClient();
    const { rateLimitRemaining } = await mock.searchRepos({
      query: 'test', sort: 'stars', order: 'desc', perPage: 5,
    });
    expect(rateLimitRemaining).toBeGreaterThan(0);
  });
});
