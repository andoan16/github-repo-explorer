import { describe, it, expect } from 'vitest';
import { RefinementValidator } from '../../src/main/search/refinement-validator';
import type { GitHubRepo } from '../../src/shared/types';

function makeRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    full_name: 'owner/repo',
    html_url: 'https://github.com/owner/repo',
    description: 'A test repo',
    stars: 500,
    forks: 42,
    language: 'Python',
    license: { key: 'mit', name: 'MIT' },
    updated_at: '2024-01-01T00:00:00Z',
    topics: ['testing'],
    open_issues: 5,
    default_branch: 'main',
    archived: false,
    ...overrides,
  };
}

describe('RefinementValidator', () => {
  const validator = new RefinementValidator();

  it('passes valid suggestions through, drops ones with insufficient repos', () => {
    const repos = [makeRepo(), makeRepo({ id: 2, full_name: 'other/proj' })];
    const result = validator.validate(
      ['show more active projects', 'prefer TypeScript'],
      repos,
      {},
    );
    // "show more active projects" — no extractable lang/license/star → valid
    // "prefer TypeScript" — no TypeScript repos → cardinality drop
    expect(result.valid).toEqual(['show more active projects']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].kind).toBe('cardinality');
  });

  it('drops language suggestion already filtered (redundancy)', () => {
    const repos = [makeRepo()];
    const result = validator.validate(
      ['prefer Python'],
      repos,
      { language: 'Python' },
    );
    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('already filtered to Python');
    expect(result.dropped[0].kind).toBe('redundancy');
  });

  it('drops license suggestion already filtered (redundancy)', () => {
    const repos = [makeRepo()];
    const result = validator.validate(
      ['only show MIT-licensed projects'],
      repos,
      { license: 'mit' },
    );
    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('already filtered to mit');
    expect(result.dropped[0].kind).toBe('redundancy');
  });

  it('returns original when only cardinality drops (safety net)', () => {
    const repos = [
      makeRepo({ id: 1, stars: 200 }),
      makeRepo({ id: 2, stars: 300, full_name: 'other/a' }),
    ];
    const result = validator.validate(
      ['only above 1000 stars'],
      repos,
      {},
    );
    // Cardinality drop, but safety net fires since no redundancy drops → return original
    expect(result.valid).toEqual(['only above 1000 stars']);
    expect(result.dropped).toHaveLength(0);
  });

  it('passes star threshold when enough results exist', () => {
    const repos = [
      makeRepo({ id: 1, stars: 2000 }),
      makeRepo({ id: 2, stars: 5000, full_name: 'other/a' }),
    ];
    const result = validator.validate(
      ['only above 1000 stars'],
      repos,
      {},
    );
    expect(result.valid).toEqual(['only above 1000 stars']);
    expect(result.dropped).toHaveLength(0);
  });

  it('does NOT use safety net when redundancy drops exist', () => {
    // 1 Rust repo, filter: language=Python
    // "prefer Python" → redundancy (already filtered to Python)
    // Safety net should NOT fire because a redundancy drop exists
    const repos = [makeRepo({ language: 'Rust' })];
    const result = validator.validate(
      ['prefer Python'],
      repos,
      { language: 'Python' },
    );
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].kind).toBe('redundancy');
  });

  it('detects language from "try Rust" and passes it when enough repos', () => {
    const repos = [
      makeRepo({ id: 1, language: 'Rust' }),
      makeRepo({ id: 2, language: 'Rust', full_name: 'other/b' }),
    ];
    const result = validator.validate(
      ['try Rust alternatives'],
      repos,
      {},
    );
    expect(result.valid).toEqual(['try Rust alternatives']);
  });

  it('detects "5k" star threshold', () => {
    const repos = [
      makeRepo({ id: 1, stars: 6000 }),
      makeRepo({ id: 2, stars: 8000, full_name: 'other/b' }),
    ];
    const result = validator.validate(
      ['only 5k+ stars'],
      repos,
      {},
    );
    expect(result.valid).toEqual(['only 5k+ stars']);
  });

  it('drops "5k" star threshold then safety net restores (only cardinality)', () => {
    const repos = [makeRepo({ id: 1, stars: 2000 })];
    const result = validator.validate(
      ['only 5k stars', 'show more recent updates'],
      repos,
      {},
    );
    // "only 5k stars" → cardinality (0 repos >= 5000)
    // "show more recent updates" → no extractable lang/license/star → valid
    // Since we have a valid suggestion AND a cardinality drop, safety net NOT needed
    expect(result.valid).toEqual(['show more recent updates']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].kind).toBe('cardinality');
  });

  it('returns empty valid array for empty input', () => {
    const result = validator.validate([], [], {});
    expect(result.valid).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});
