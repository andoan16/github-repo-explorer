import { describe, it, expect } from 'vitest';
import { mineNegativeSpace } from '../../src/main/search/result-stats';
import type { GitHubRepo } from '../../src/shared/types';

function makeRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    full_name: 'owner/repo',
    html_url: '',
    description: 'A batch processing dashboard for server metrics',
    stars: 500,
    forks: 0,
    language: 'Python',
    license: { key: 'mit', name: 'MIT' },
    updated_at: '2024-01-01T00:00:00Z',
    topics: ['monitoring', 'metrics'],
    open_issues: 0,
    default_branch: 'main',
    archived: false,
    ...overrides,
  };
}

describe('mineNegativeSpace', () => {
  it('returns empty when no repos', () => {
    const result = mineNegativeSpace('real-time monitoring', []);
    expect(result.summary).toBe('');
    expect(result.gaps).toEqual([]);
  });

  it('detects missing qualifier "real-time" when absent from results', () => {
    const repos = [
      makeRepo(),
      makeRepo({ id: 2, description: 'Server monitoring tool', full_name: 'a/b' }),
    ];
    const result = mineNegativeSpace('real-time server monitoring', repos, 10);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].keyword).toBe('real-time');
    expect(result.gaps[0].presence).toBe(0);
  });

  it('passes "real-time" when it appears in repo descriptions', () => {
    const repos = [
      makeRepo({ id: 1, description: 'Real-time monitoring dashboard' }),
      makeRepo({ id: 2, description: 'A real-time observability tool', full_name: 'a/b' }),
    ];
    const result = mineNegativeSpace('real-time monitoring', repos, 10);
    // 2 of 2 repos contain "real-time" → 100% → NOT a gap
    expect(result.gaps).toEqual([]);
  });

  it('detects "self-hosted" qualifier', () => {
    const repos = [
      makeRepo({ id: 1, description: 'Cloud monitoring service' }),
      makeRepo({ id: 2, description: 'SaaS observability platform', full_name: 'a/b' }),
    ];
    const result = mineNegativeSpace('self-hosted monitoring tool', repos, 10);
    const gap = result.gaps.find((g) => g.keyword === 'self-hosted');
    expect(gap).toBeDefined();
    expect(gap!.presence).toBe(0);
  });

  it('catches "real-time" even when hyphenated differently', () => {
    const repos = [
      makeRepo({ id: 1, description: 'Real time data processing' }),
      makeRepo({ id: 2, description: 'realtime analytics', full_name: 'a/b' }),
    ];
    const result = mineNegativeSpace('realTime monitoring', repos, 10);
    // Both repos mention real-time in some form → not a gap
    const gap = result.gaps.find((g) => g.keyword === 'real-time');
    // The normalized form is "real-time" — both repos match
    expect(gap).toBeUndefined();
  });

  it('extracts content words and detects missing ones', () => {
    const repos = [
      makeRepo({ id: 1, description: 'Dashboard for metrics' }),
    ];
    const result = mineNegativeSpace('Kubernetes native monitoring', repos, 10);
    const gap = result.gaps.find((g) => g.keyword === 'kubernetes');
    expect(gap).toBeDefined();
    expect(gap!.presence).toBe(0);
  });

  it('filters out generic words', () => {
    const repos = [makeRepo()];
    const result = mineNegativeSpace('I want a good tool for building nice projects', repos, 10);
    // "good", "tool", "nice", "projects" are all generic — no claim-words extracted
    expect(result.gaps).toEqual([]);
  });

  it('prioritizes qualifiers over content words (dedup)', () => {
    const repos = [
      makeRepo({ id: 1, description: 'Standard CI tool' }),
    ];
    // "real-time" is a qualifier; "real" + "time" are content words
    // Qualifiers should take precedence — only one entry for "real-time"
    const result = mineNegativeSpace('real-time monitoring', repos, 10);
    const rtGaps = result.gaps.filter((g) => g.keyword.includes('real'));
    expect(rtGaps.length).toBeLessThanOrEqual(1);
  });

  it('builds summary string', () => {
    const repos = [makeRepo()];
    const result = mineNegativeSpace('real-time kubernetes monitoring', repos, 10);
    expect(result.summary).toContain('real-time');
    expect(result.summary).toContain('kubernetes');
    expect(result.summary).toContain('%');
  });

  it('handles repos with no description and no topics', () => {
    const repos = [
      makeRepo({ id: 1, description: null, topics: [] }),
    ];
    const result = mineNegativeSpace('kubernetes', repos, 10);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].keyword).toBe('kubernetes');
    expect(result.gaps[0].presence).toBe(0);
  });

  it('detects keyword in full_name', () => {
    const repos = [
      makeRepo({ id: 1, full_name: 'kubernetes/kubernetes', description: 'production-grade container orchestration' }),
      makeRepo({ id: 2, full_name: 'prometheus/prometheus', description: 'monitoring' }),
    ];
    // "kubernetes" appears in repo #1's full_name → 50% presence → flagged (<20%)
    const result = mineNegativeSpace('kubernetes monitoring', repos, 10);
    const gap = result.gaps.find((g) => g.keyword === 'kubernetes');
    // 50% presence ≥ 20% → not flagged as gap
    expect(gap).toBeUndefined();
  });

  it('detects keyword spread across description + topics', () => {
    const repos = [
      makeRepo({ id: 1, description: 'kubernetes metrics', topics: ['kubernetes'] }),
      makeRepo({ id: 2, description: 'kubernetes native', topics: [], full_name: 'a/b' }),
    ];
    const result = mineNegativeSpace('kubernetes grafana', repos, 10);
    // "kubernetes" in 2 of 2 repos → 100% → not a gap
    // "grafana" in 0 of 2 → 0% → IS a gap (not in stoplist)
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].keyword).toBe('grafana');
    expect(result.gaps[0].presence).toBe(0);
  });
});
