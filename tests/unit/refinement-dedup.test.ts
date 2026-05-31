import { describe, it, expect } from 'vitest';

// Replicated from useSearch.ts for testing — same logic
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of',
  'is', 'it', 'as', 'at', 'be', 'by', 'me', 'my', 'we', 'our', 'this',
  'that', 'more', 'less', 'only', 'show', 'try', 'use', 'prefer', 'filter',
  'switch', 'move', 'focus', 'keep', 'remove', 'add',
]);

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function isRefinementDuplicate(text: string, applied: Set<string>): boolean {
  if (applied.has(text)) return true;

  const words = normalizeWords(text);
  if (words.length === 0) return false;

  for (const appliedText of applied) {
    const appliedWords = normalizeWords(appliedText);
    const overlap = words.filter((w) => appliedWords.includes(w)).length;
    if (overlap === 0) continue;

    const union = new Set([...words, ...appliedWords]).size;
    const jaccard = overlap / union;

    // High word-set overlap → same intent (lowered threshold for short phrases)
    if (jaccard >= 0.33) return true;

    // Single-content-word match: when either phrase has only one
    // meaningful word, any overlap is a duplicate
    if (
      overlap >= 1 &&
      (words.length === 1 || appliedWords.length === 1)
    ) {
      return true;
    }

    // Subset check: one phrase is entirely contained in the other
    if (
      overlap === Math.min(words.length, appliedWords.length) &&
      overlap >= 2
    ) {
      return true;
    }
  }

  return false;
}

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
