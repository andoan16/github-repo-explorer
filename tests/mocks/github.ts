import { vi } from 'vitest';
import type { GitHubRepo } from '../../src/shared/types';

export function makeMockRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 123456,
    full_name: 'org/test-repo',
    html_url: 'https://github.com/org/test-repo',
    description: 'A test repository for CI/CD pipelines',
    stars: 5000,
    forks: 200,
    language: 'Go',
    license: { key: 'mit', name: 'MIT License' },
    updated_at: new Date().toISOString(),
    topics: ['docker', 'ci-cd', 'devops'],
    open_issues: 30,
    default_branch: 'main',
    archived: false,
    ...overrides,
  };
}

export function makeMockRepos(count: number): GitHubRepo[] {
  return Array.from({ length: count }, (_, i) => makeMockRepo({
    id: i + 1,
    full_name: `org/repo-${i + 1}`,
    html_url: `https://github.com/org/repo-${i + 1}`,
    stars: 10000 - i * 500,
    description: `Repository number ${i + 1} for development`,
  }));
}

export function createMockGitHubClient() {
  return {
    checkToken: vi.fn().mockResolvedValue({ valid: true, user: 'testuser' }),
    searchRepos: vi.fn().mockResolvedValue({
      repos: makeMockRepos(15),
      totalCount: 15,
      rateLimitRemaining: 4500,
    }),
    getReadme: vi.fn().mockResolvedValue('# Test Repository\n\nThis is a test README for CI/CD automation.\n\n## Features\n- Docker support\n- Kubernetes integration\n- Web UI dashboard'),
  };
}

export function createInvalidTokenGitHubClient() {
  return {
    checkToken: vi.fn().mockResolvedValue({ valid: false, error: 'Invalid or expired token' }),
    searchRepos: vi.fn().mockRejectedValue(new Error('Bad credentials')),
    getReadme: vi.fn().mockRejectedValue(new Error('Bad credentials')),
  };
}
