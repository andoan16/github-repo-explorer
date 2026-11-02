import { describe, it, expect } from 'vitest';
import { isRefinementDuplicate } from '../../src/shared/search-utils';

describe('applied-refinement dedup', () => {
  it('exact match is a duplicate', () => {
    const applied = new Set(['prefer Go']);
    expect(isRefinementDuplicate('prefer Go', applied)).toBe(true);
  });

  it('near-duplicate via Jaccard similarity', () => {
    const applied = new Set(['prefer Go']);
    expect(isRefinementDuplicate('try Go', applied)).toBe(true);
  });

  it('different intent passes through', () => {
    const applied = new Set(['prefer Go']);
    expect(isRefinementDuplicate('MIT license only', applied)).toBe(false);
  });

  it('detects "filter to Go" as duplicate of "prefer Go"', () => {
    const applied = new Set(['prefer Go']);
    expect(isRefinementDuplicate('filter to Go', applied)).toBe(true);
  });

  it('detects "Go based tools" as duplicate of "prefer Go"', () => {
    const applied = new Set(['prefer Go']);
    expect(isRefinementDuplicate('Go based tools', applied)).toBe(true);
  });

  it('"more devops focused" after "more DevOps" is duplicate', () => {
    const applied = new Set(['more DevOps focused']);
    expect(isRefinementDuplicate('more DevOps', applied)).toBe(true);
  });

  it('passes unrelated suggestion through', () => {
    const applied = new Set(['prefer Go']);
    expect(isRefinementDuplicate('sort by stars', applied)).toBe(false);
  });

  it('handles empty applied set', () => {
    const applied = new Set<string>();
    expect(isRefinementDuplicate('prefer Go', applied)).toBe(false);
  });

  it('detects duplicate among multiple applied', () => {
    const applied = new Set(['prefer Go', 'MIT only', 'above 1000 stars']);
    expect(isRefinementDuplicate('switch to Go', applied)).toBe(true);
    expect(isRefinementDuplicate('MIT license', applied)).toBe(true);
    expect(isRefinementDuplicate('more DevOps', applied)).toBe(false);
  });

  it('false negative: "only active projects" after "recently updated" is NOT a duplicate', () => {
    const applied = new Set(['recently updated']);
    expect(isRefinementDuplicate('only active projects', applied)).toBe(false);
  });
});
