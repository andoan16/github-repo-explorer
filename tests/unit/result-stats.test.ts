import { describe, it, expect } from 'vitest';
import { computeResultStatistics } from '../../src/main/search/result-stats';
import type { GitHubRepo } from '../../src/shared/types';

function makeRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    full_name: 'owner/repo',
    html_url: '',
    description: '',
    stars: 500,
    forks: 0,
    language: 'Python',
    license: { key: 'mit', name: 'MIT' },
    updated_at: '2024-01-01T00:00:00Z',
    topics: ['observability'],
    open_issues: 0,
    default_branch: 'main',
    archived: false,
    ...overrides,
  };
}

describe('computeResultStatistics', () => {
  it('returns N/A for empty input', () => {
    const stats = computeResultStatistics([]);
    expect(stats.languageDistribution).toBe('N/A');
    expect(stats.licenseDistribution).toBe('N/A');
    expect(stats.starRange).toBe('N/A');
    expect(stats.topTopics).toBe('N/A');
  });

  it('computes language distribution', () => {
    const repos = [
      makeRepo(),
      makeRepo({ id: 2, language: 'Python', full_name: 'a/b' }),
      makeRepo({ id: 3, language: 'Go', full_name: 'c/d' }),
      makeRepo({ id: 4, language: 'Go', full_name: 'e/f' }),
    ];
    const stats = computeResultStatistics(repos);
    expect(stats.languageDistribution).toBe('Go (2 of 4, 50%), Python (2 of 4, 50%)');
  });

  it('computes license distribution', () => {
    const repos = [
      makeRepo(),
      makeRepo({ id: 2, license: null, full_name: 'a/b' }),
      makeRepo({ id: 3, license: { key: 'apache-2.0', name: 'Apache 2.0' }, full_name: 'c/d' }),
    ];
    const stats = computeResultStatistics(repos);
    expect(stats.licenseDistribution).toContain('mit (1 of 3, 33%)');
    expect(stats.licenseDistribution).toContain('none (1 of 3, 33%)');
    expect(stats.licenseDistribution).toContain('apache-2.0 (1 of 3, 33%)');
  });

  it('computes star range with median', () => {
    const repos = [
      makeRepo({ id: 1, stars: 100 }),
      makeRepo({ id: 2, stars: 500, full_name: 'a/b' }),
      makeRepo({ id: 3, stars: 900, full_name: 'c/d' }),
    ];
    const stats = computeResultStatistics(repos);
    expect(stats.starRange).toBe('100 — 900 (median 500)');
  });

  it('computes top topic distribution', () => {
    const repos = [
      makeRepo({ id: 1, topics: ['monitoring', 'docker'] }),
      makeRepo({ id: 2, topics: ['monitoring', 'prometheus'], full_name: 'a/b' }),
      makeRepo({ id: 3, topics: ['docker'], full_name: 'c/d' }),
    ];
    const stats = computeResultStatistics(repos);
    expect(stats.topTopics).toContain('monitoring (2)');
    expect(stats.topTopics).toContain('docker (2)');
    expect(stats.topTopics).toContain('prometheus (1)');
  });

  it('handles repos with no language, no license, no topics', () => {
    const repos = [
      makeRepo({ id: 1, language: null, license: null, topics: [] }),
      makeRepo({ id: 2, full_name: 'a/b', language: null, license: null, topics: [] }),
    ];
    const stats = computeResultStatistics(repos);
    expect(stats.languageDistribution).toBe('');
    expect(stats.licenseDistribution).toBe('none (2 of 2, 100%)');
    expect(stats.topTopics).toBe('');
  });
});
