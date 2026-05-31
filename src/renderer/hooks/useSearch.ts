import { useState, useCallback, useRef } from 'react';
import type { GitHubSearchResult } from '../../shared/types';

interface SearchState {
  searching: boolean;
  hasSearched: boolean;
  results: GitHubSearchResult[];
  totalSearched: number;
  error: string | null;
  suggestions: string[];
}

/**
 * Returns true if `text` is semantically similar to any refinement in `applied`.
 * Catches "prefer Go" ≈ "try Go" ≈ "Go-based tools" ≈ "filter to Go".
 */
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
    // e.g. "prefer Go" (content: ["go"]) ≈ "Go based tools" (content: ["go","based","tools"])
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

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of',
  'is', 'it', 'as', 'at', 'be', 'by', 'me', 'my', 'we', 'our', 'this',
  'that', 'more', 'less', 'only', 'show', 'try', 'use', 'prefer', 'filter',
  'switch', 'move', 'focus', 'keep', 'remove', 'add',
]);

export function useSearch() {
  const [state, setState] = useState<SearchState>({
    searching: false,
    hasSearched: false,
    results: [],
    totalSearched: 0,
    error: null,
    suggestions: [],
  });

  const [selectedResult, setSelectedResult] = useState<GitHubSearchResult | null>(null);

  // Track refinements applied this session so we don't suggest them again
  const appliedRefinements = useRef(new Set<string>());

  const execute = useCallback(async (request: string, filters?: unknown) => {
    if (!request.trim()) return;

    // Clear applied refinements on brand-new search
    appliedRefinements.current = new Set();

    setState({
      searching: true,
      hasSearched: true,
      results: [],
      totalSearched: 0,
      error: null,
      suggestions: [],
    });
    setSelectedResult(null);

    const res = await window.repoExplorer.search(request, filters);

    if (res.ok && res.data) {
      const data = res.data as { results: GitHubSearchResult[]; totalSearched: number; suggestions?: string[] };
      const rawSuggestions = data.suggestions ?? [];
      setState({
        searching: false,
        hasSearched: true,
        results: data.results,
        totalSearched: data.totalSearched,
        error: null,
        suggestions: rawSuggestions.filter((s) => !isRefinementDuplicate(s, appliedRefinements.current)),
      });
    } else {
      setState({
        searching: false,
        hasSearched: true,
        results: [],
        totalSearched: 0,
        error: res.error ?? 'Unknown error',
        suggestions: [],
      });
    }
  }, []);

  const refine = useCallback(async (refinementText: string) => {
    if (!refinementText.trim()) return;

    // Record this refinement so we don't suggest it again
    appliedRefinements.current.add(refinementText.trim());

    setState({
      searching: true,
      hasSearched: true,
      results: [],
      totalSearched: 0,
      error: null,
      suggestions: [],
    });
    setSelectedResult(null);

    const res = await window.repoExplorer.refine(refinementText);

    if (res.ok && res.data) {
      const data = res.data as { results: GitHubSearchResult[]; totalSearched: number; note?: string };
      setState({
        searching: false,
        hasSearched: true,
        results: data.results,
        totalSearched: data.totalSearched,
        error: null,
        suggestions: [],
      });
    } else {
      setState({
        searching: false,
        hasSearched: true,
        results: [],
        totalSearched: 0,
        error: res.error ?? 'Unknown error during refinement',
        suggestions: [],
      });
    }
  }, []);

  const clear = useCallback(() => {
    appliedRefinements.current = new Set();
    setState({
      searching: false,
      hasSearched: false,
      results: [],
      totalSearched: 0,
      error: null,
      suggestions: [],
    });
    setSelectedResult(null);
  }, []);

  return { ...state, selectedResult, setSelectedResult, execute, refine, clear };
}
