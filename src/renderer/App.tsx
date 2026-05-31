import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import SearchBar from './components/SearchBar';
import Filters from './components/Filters';
import ResultCard from './components/ResultCard';
import RepoDetail from './components/RepoDetail';
import Settings from './components/Settings';
import BookmarksPanel from './components/BookmarksPanel';
import ComparisonView from './components/ComparisonView';
import { useSettings } from './hooks/useSettings';
import { useOllama } from './hooks/useOllama';
import { useSearch } from './hooks/useSearch';
import { useBookmarks } from './hooks/useBookmarks';
import type { SearchFilters, Bookmark, GitHubSearchResult } from '../shared/types';

const defaultFilters: SearchFilters = { language: null, license: null, minStars: 0, maxAgeMonths: null };

export default function App() {
  const { settings, saveSettings } = useSettings();
  const { status: ollamaStatus, check: checkOllama, refreshModels } = useOllama();
  const { searching, hasSearched, results, totalSearched, error, suggestions, selectedResult, setSelectedResult, execute, refine, clear } = useSearch();
  const { bookmarks, isBookmarked, toggleBookmark, removeBookmark } = useBookmarks();

  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [showSettings, setShowSettings] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set());
  const [githubChecked, setGithubChecked] = useState(false);
  const [githubUser, setGithubUser] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => {
    checkOllama(settings.ollamaBaseUrl);
    window.repoExplorer.checkGitHub(settings.githubToken).then((res) => {
      setGithubChecked(true);
      if (res.ok && res.data) {
        setGithubUser(res.data.valid ? res.data.user : null);
      }
    });
  }, []);

  const handleCheckGitHub = useCallback(async (token?: string) => {
    const t = token ?? settings.githubToken;
    const res = await window.repoExplorer.checkGitHub(t);
    setGithubChecked(true);
    if (res.ok && res.data) {
      setGithubUser(res.data.valid ? res.data.user : null);
    }
    return res.ok;
  }, [settings.githubToken]);

  const handleCheckOllama = useCallback(async (url?: string) => {
    const ok = await checkOllama(url);
    if (ok) await refreshModels();
    return ok;
  }, [checkOllama, refreshModels]);

  const lastSearchTime = useRef(0);
  const DEBOUNCE_MS = 300;

  const handleSearch = useCallback((query: string) => {
    // Debounce: prevent rapid re-submissions within 300ms
    const now = Date.now();
    if (now - lastSearchTime.current < DEBOUNCE_MS) return;
    lastSearchTime.current = now;

    setCompareIds(new Set());
    setVisibleCount(20);
    execute(query, filters);
  }, [execute, filters]);

  const handleFindSimilar = useCallback((result: GitHubSearchResult) => {
    const parts = [...result.repo.topics, result.repo.description].filter(Boolean);
    const query = parts.length > 0 ? parts.join(' ') : result.repo.full_name;
    handleSearch(query);
  }, [handleSearch]);

  const handleBookmark = useCallback((e: React.MouseEvent, result: GitHubSearchResult) => {
    e.stopPropagation();
    toggleBookmark({ repo: result.repo, savedAt: new Date().toISOString() });
  }, [toggleBookmark]);

  const handleCompareToggle = useCallback((id: number) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectBookmarked = useCallback((bookmark: Bookmark) => {
    setShowBookmarks(false);
    // Show the bookmarked repo in the detail view using a synthetic result
    const synthetic: GitHubSearchResult = {
      repo: bookmark.repo,
      readme: null,
      score: { total: 0, semanticMatch: 0, starsScore: 0, activityScore: 0, readmeRelevance: 0, languageMatch: 0, licenseCompatibility: 0 },
      matchExplanation: 'Saved bookmark',
    };
    setSelectedResult(synthetic);
  }, [setSelectedResult]);

  const compareResults = useMemo(() => {
    return results.filter((r) => compareIds.has(r.repo.id));
  }, [results, compareIds]);

  const displayedResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const hasMore = visibleCount < results.length;

  // IntersectionObserver sentinel for infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((c) => c + 20); },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, visibleCount]);

  const readOnly = !ollamaStatus.connected;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          Repo Explorer
        </h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => setShowBookmarks(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            Bookmarks
            {bookmarks.length > 0 && <span className="badge">{bookmarks.length}</span>}
          </button>
          <button className="btn-secondary" onClick={() => setShowSettings(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Settings
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="search-section">
          <SearchBar onSearch={handleSearch} searching={searching} disabled={readOnly} />
          <Filters filters={filters} onChange={setFilters} disabled={searching} />
        </div>

        {error && (
          <div className="error-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
            <button className="btn-secondary" onClick={clear}>Dismiss</button>
          </div>
        )}

        {searching && (
          <div className="loading-state">
            <span className="spinner large" />
            <p>Searching...</p>
          </div>
        )}

        {!searching && results.length > 0 && (
          <>
            <div className="results-summary">
              <span>
                Found {results.length} repos out of {totalSearched.toLocaleString()} searched
              </span>
              <div className="results-toolbar">
                {compareIds.size >= 2 && (
                  <button className="btn-secondary" onClick={() => setShowComparison(true)}>
                    Compare ({compareIds.size})
                  </button>
                )}
              </div>
            </div>
            {suggestions.length > 0 && (
              <div className="suggestions-row">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="suggestion-chip"
                    onClick={() => refine(s)}
                    disabled={searching}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="refinement-bar">
              <input
                type="text"
                placeholder="Refine results, e.g. 'more DevOps focused' or 'less enterprise, prefer Go'..."
                disabled={searching}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    refine(e.currentTarget.value.trim());
                    e.currentTarget.value = '';
                  }
                }}
              />
              <button
                className="btn-secondary"
                disabled={searching}
                onClick={(e) => {
                  const input = (e.currentTarget as HTMLButtonElement).previousElementSibling as HTMLInputElement;
                  if (input.value.trim()) {
                    refine(input.value.trim());
                    input.value = '';
                  }
                }}
              >
                Refine
              </button>
            </div>
            <div className="results-grid">
              {displayedResults.map((r, i) => (
                <ResultCard
                  key={r.repo.id}
                  result={r}
                  rank={i + 1}
                  bookmarked={isBookmarked(r.repo.id)}
                  selectedForCompare={compareIds.has(r.repo.id)}
                  onClick={() => setSelectedResult(r)}
                  onBookmark={(e) => handleBookmark(e, r)}
                  onCompareToggle={handleCompareToggle}
                  onFindSimilar={() => handleFindSimilar(r)}
                />
              ))}
            </div>
            {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          </>
        )}

        {!searching && !error && hasSearched && results.length === 0 && (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" className="empty-icon">
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="15" x2="16" y2="15" />
            </svg>
            <h2>No repositories found</h2>
            <p>Try broadening your description, removing filters, or using different keywords.</p>
            <button className="btn-secondary" onClick={clear}>Try a new search</button>
          </div>
        )}

        {!searching && !error && !hasSearched && (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64" className="empty-icon">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <h2>Discover GitHub Repositories</h2>
            <p>
              Describe what you want to build or use in plain English.
              The app will understand your intent and find the best matching repositories.
            </p>
            <div className="example-queries">
              <p>Try these examples:</p>
              <button className="example-chip" onClick={() => handleSearch('I need a self-hosted CI/CD platform with Docker support')}>
                "Self-hosted CI/CD with Docker"
              </button>
              <button className="example-chip" onClick={() => handleSearch('A Python library for working with PDFs — extract text, fill forms, merge documents')}>
                "Python library for PDF manipulation"
              </button>
              <button className="example-chip" onClick={() => handleSearch('Open source tool for monitoring server metrics with a nice dashboard')}>
                "Server monitoring with dashboard"
              </button>
            </div>
          </div>
        )}
      </main>

      {selectedResult && (
        <RepoDetail
          result={selectedResult}
          bookmarked={isBookmarked(selectedResult.repo.id)}
          onClose={() => setSelectedResult(null)}
          onBookmark={(e) => handleBookmark(e, selectedResult)}
        />
      )}

      {showBookmarks && (
        <BookmarksPanel
          bookmarks={bookmarks}
          onSelect={handleSelectBookmarked}
          onRemove={(id) => removeBookmark(id)}
          onClose={() => setShowBookmarks(false)}
        />
      )}

      {showComparison && (
        <ComparisonView
          results={compareResults}
          onClose={() => setShowComparison(false)}
        />
      )}

      {showSettings && (
        <Settings
          settings={settings}
          ollamaModels={ollamaStatus.models}
          ollamaConnected={ollamaStatus.connected}
          githubUser={githubUser}
          githubValid={githubChecked ? !!githubUser : null}
          onSave={saveSettings}
          onCheckOllama={handleCheckOllama}
          onCheckGitHub={handleCheckGitHub}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
