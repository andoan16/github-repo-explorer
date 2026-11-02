/**
 * Shared search and suggestion normalization utilities.
 * Used across Main Process (IPC handlers, query generator) and Renderer Process (useSearch hook).
 */

export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of',
  'is', 'it', 'as', 'at', 'be', 'by', 'me', 'my', 'we', 'our', 'this',
  'that', 'more', 'less', 'only', 'show', 'try', 'use', 'prefer', 'filter',
  'switch', 'move', 'focus', 'keep', 'remove', 'add', 'based', 'tools', 'projects',
]);

/**
 * Normalizes a text string into search tokens, preserving technical punctuation
 * (/-+. in compound terms like ci/cd, self-hosted, c++) while stripping syntactic stopwords.
 */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s\/\-\+\.]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Calculates Jaccard similarity coefficient between two word arrays.
 */
export function jaccardSimilarity(wordsA: string[], wordsB: string[]): number {
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const overlap = wordsA.filter((w) => wordsB.includes(w)).length;
  if (overlap === 0) return 0;
  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap / union;
}

/**
 * Checks if a candidate suggestion is a semantic duplicate of any already-applied refinement.
 */
export function isRefinementDuplicate(text: string, applied: Set<string>): boolean {
  if (applied.has(text)) return true;

  const words = normalizeWords(text);
  if (words.length === 0) return false;

  for (const appliedText of applied) {
    const appliedWords = normalizeWords(appliedText);
    const overlap = words.filter((w) => appliedWords.includes(w)).length;
    if (overlap === 0) continue;

    const jaccard = jaccardSimilarity(words, appliedWords);
    if (jaccard >= 0.33) return true;

    // Single-content-word match: when either phrase has only one meaningful word, any overlap is a duplicate
    if (overlap >= 1 && (words.length === 1 || appliedWords.length === 1)) {
      return true;
    }

    // Subset check: one phrase is entirely contained in the other
    if (overlap === Math.min(words.length, appliedWords.length) && overlap >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Removes near-duplicate suggestions within a batch using Jaccard similarity.
 */
export function deduplicateBatch(suggestions: string[]): string[] {
  const result: string[] = [];
  const normCache = new Map<string, string[]>();
  const getWords = (s: string) => {
    if (!normCache.has(s)) normCache.set(s, normalizeWords(s));
    return normCache.get(s)!;
  };

  for (const s of suggestions) {
    const trimmed = s.trim();
    if (!trimmed || /^(suggest(ion)?|example|phrase|query|item|keyword)(\s*\d+)?$/i.test(trimmed)) {
      continue;
    }
    const words = getWords(trimmed);
    let isDuplicate = false;
    for (const existing of result) {
      const existingWords = getWords(existing);
      const overlap = words.filter((w) => existingWords.includes(w)).length;
      if (overlap === 0) continue;
      const jaccard = jaccardSimilarity(words, existingWords);
      if (jaccard >= 0.5) { isDuplicate = true; break; }
      if (overlap >= 1 && (words.length === 1 || existingWords.length === 1) && words[0] === existingWords[0]) {
        isDuplicate = true; break;
      }
    }
    if (!isDuplicate) result.push(trimmed);
  }
  return result;
}

/**
 * Merges near-duplicate search queries to avoid redundant API calls.
 */
export function deduplicateSimilarQueries<T extends { query: string }>(params: T[]): T[] {
  if (params.length <= 2) return params;
  const result: T[] = [];
  const normalizedCache = new Map<string, string[]>();
  const getWords = (q: string) => {
    if (!normalizedCache.has(q)) normalizedCache.set(q, normalizeWords(q));
    return normalizedCache.get(q)!;
  };

  for (const p of params) {
    let isDup = false;
    const a = getWords(p.query);
    for (const existing of result) {
      const b = getWords(existing.query);
      const overlap = a.filter((w) => b.includes(w)).length;
      if (overlap === 0) continue;
      const jaccard = jaccardSimilarity(a, b);
      if (jaccard >= 0.5) { isDup = true; break; }
    }
    if (!isDup) result.push(p);
  }
  return result;
}
