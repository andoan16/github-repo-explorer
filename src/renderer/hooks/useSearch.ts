import { useState, useCallback, useRef, useEffect } from 'react';
import type { GitHubSearchResult } from '../../shared/types';

interface SearchState {
  searching: boolean;
  hasSearched: boolean;
  results: GitHubSearchResult[];
  totalSearched: number;
  error: string | null;
  suggestions: string[];
  moreAvailable: boolean;
  /** True while loading-more pagination is in progress (does NOT hide results) */
  loadingMore: boolean;
  /** Error from the last load-more attempt (rate limit, network, etc.) */
  loadMoreError: string | null;
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

    if (jaccard >= 0.33) return true;

    if (
      overlap >= 1 &&
      (words.length === 1 || appliedWords.length === 1)
    ) {
      return true;
    }

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
    moreAvailable: false,
    loadingMore: false,
    loadMoreError: null,
  });

  const [selectedResult, setSelectedResult] = useState<GitHubSearchResult | null>(null);

  const appliedRefinements = useRef(new Set<string>());
  const currentGenRef = useRef(0);

  // Listen for async suggestion updates from backend (suggestions are still fire-and-forget)
  useEffect(() => {
    const cleanup = window.repoExplorer.onSuggestionsUpdate((suggestions: string[]) => {
      setState(s => ({
        ...s,
        suggestions: suggestions.filter((sg) => !isRefinementDuplicate(sg, appliedRefinements.current)),
      }));
    });
    return cleanup;
  }, []);

  const execute = useCallback(async (request: string, filters?: unknown) => {
    if (!request.trim()) return;

    // Increment generation counter for cancellation. Any in-flight request
    // with a lower generation is stale and its result must be discarded.
    const gen = ++currentGenRef.current;
    appliedRefinements.current = new Set();

    setState({
      searching: true,
      hasSearched: true,
      results: [],
      totalSearched: 0,
      error: null,
      suggestions: [],
      moreAvailable: false,
      loadingMore: false,
      loadMoreError: null,
    });
    setSelectedResult(null);

    const res = await window.repoExplorer.search(request, filters);

    // Guard: if a newer search/refine was triggered while we were waiting,
    // discard this result to avoid overwriting fresher state.
    if (gen !== currentGenRef.current) return;

    if (res.ok && res.data) {
      const data = res.data as { results: GitHubSearchResult[]; totalSearched: number; suggestions?: string[] };
      setState({
        searching: false,
        hasSearched: true,
        results: data.results,
        totalSearched: data.totalSearched,
        error: null,
        moreAvailable: true,
        suggestions: [],
        loadingMore: false,
        loadMoreError: null,
      });
    } else {
      setState({
        searching: false,
        hasSearched: true,
        results: [],
        totalSearched: 0,
        error: res.error ?? 'Unknown error',
        suggestions: [],
        moreAvailable: false,
        loadingMore: false,
        loadMoreError: null,
      });
    }
  }, []);

  const refine = useCallback(async (refinementText: string): Promise<number | undefined> => {
    if (!refinementText.trim()) return undefined;

    // Increment generation counter so any in-flight execute/loadMore is cancelled.
    const gen = ++currentGenRef.current;
    appliedRefinements.current.add(refinementText.trim());

    // Keep existing results visible during refinement — only show the searching
    // spinner. Clearing results here causes a jarring flash of empty state.
    setState(s => ({
      ...s,
      searching: true,
      error: null,
      suggestions: [],
      loadingMore: false,
      loadMoreError: null,
    }));
    setSelectedResult(null);

    const res = await window.repoExplorer.refine(refinementText);

    // Guard: discard if a newer search/refine was triggered.
    if (gen !== currentGenRef.current) return undefined;

    if (res.ok && res.data) {
      const data = res.data as { results: GitHubSearchResult[]; totalSearched: number; note?: string; minStars?: number };
      setState({
        searching: false,
        hasSearched: true,
        results: data.results,
        totalSearched: data.totalSearched,
        error: null,
        suggestions: [],
        moreAvailable: false,
        loadingMore: false,
        loadMoreError: null,
      });
      return data.minStars;
    } else {
      setState({
        searching: false,
        hasSearched: true,
        results: [],
        totalSearched: 0,
        error: res.error ?? 'Unknown error during refinement',
        suggestions: [],
        moreAvailable: false,
        loadingMore: false,
        loadMoreError: null,
      });
      return undefined;
    }
  }, []);

  const loadMore = useCallback(async () => {
    // Use loadingMore, NOT searching — we want to keep results visible
    // while paginating. Setting searching=true hides the entire results
    // section and shows the big center spinner, which collapses the DOM
    // and scrolls the user back to the top.
    setState(s => ({ ...s, loadingMore: true, loadMoreError: null }));

    const res = await window.repoExplorer.searchMore();

    if (res.ok && res.data) {
      const data = res.data as { results: GitHubSearchResult[]; moreAvailable: boolean; totalSearched: number };
      setState(s => ({
        ...s,
        loadingMore: false,
        loadMoreError: null,
        results: [...s.results, ...data.results],
        totalSearched: data.totalSearched,
        moreAvailable: data.moreAvailable,
      }));
    } else {
      console.error('Load more failed:', res.error);
      setState(s => ({ ...s, loadingMore: false, loadMoreError: res.error ?? 'Failed to load more results' }));
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
      moreAvailable: false,
      loadingMore: false,
      loadMoreError: null,
    });
    setSelectedResult(null);
  }, []);

  return { ...state, selectedResult, setSelectedResult, execute, refine, loadMore, clear };
}