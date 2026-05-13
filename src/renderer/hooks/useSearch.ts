import { useState, useCallback } from 'react';
import type { GitHubSearchResult } from '../../shared/types';

interface SearchState {
  searching: boolean;
  hasSearched: boolean;
  results: GitHubSearchResult[];
  totalSearched: number;
  error: string | null;
}

export function useSearch() {
  const [state, setState] = useState<SearchState>({
    searching: false,
    hasSearched: false,
    results: [],
    totalSearched: 0,
    error: null,
  });

  const [selectedResult, setSelectedResult] = useState<GitHubSearchResult | null>(null);

  const execute = useCallback(async (request: string, filters?: unknown) => {
    if (!request.trim()) return;

    setState({
      searching: true,
      hasSearched: true,
      results: [],
      totalSearched: 0,
      error: null,
    });
    setSelectedResult(null);

    const res = await window.repoExplorer.search(request, filters);

    if (res.ok && res.data) {
      const data = res.data as { results: GitHubSearchResult[]; totalSearched: number };
      setState({
        searching: false,
        hasSearched: true,
        results: data.results,
        totalSearched: data.totalSearched,
        error: null,
      });
    } else {
      setState({
        searching: false,
        hasSearched: true,
        results: [],
        totalSearched: 0,
        error: res.error ?? 'Unknown error',
      });
    }
  }, []);

  const clear = useCallback(() => {
    setState({
      searching: false,
      hasSearched: false,
      results: [],
      totalSearched: 0,
      error: null,
    });
    setSelectedResult(null);
  }, []);

  return { ...state, selectedResult, setSelectedResult, execute, clear };
}
