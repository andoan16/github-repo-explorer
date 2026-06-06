import { ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import { OllamaClient } from './ollama/client';
import { GitHubClient } from './github/client';
import { QueryGenerator } from './search/query-gen';
import { RefinementValidator } from './search/refinement-validator';
import { RefinementParser } from './search/refinement-parser';
import { searchCache, buildSearchCacheKey, criteriaCache } from './search/cache';
import { RankingEngine } from './ranking/engine';
import { SettingsStore } from './settings/store';
import { BookmarkStore } from './bookmarks/store';
import { IPC, type AppSettings, type GitHubRepo, type GitHubSearchResult, type SearchCriteria, type SearchTimings } from '../shared/types';
import { boundedAllSettled } from './utils/concurrency';
import { createPerformanceTracker } from './search/perf';
import { VietnameseQueryExpander, VietnameseTranslationCache, translationCache, detectVietnamese, quickVietnameseTranslate, quickVietnameseTranslateStructured, VIETNAMESE_STOP_WORDS } from './search/vietnamese';

const settings = new SettingsStore();
const bookmarks = new BookmarkStore();
const rankingEngine = new RankingEngine();

interface CachedSearch {
  repos: GitHubRepo[];
  readmes: Map<number, string | null>;
  originalCriteria: SearchCriteria;
  originalRequest: string;
  /** Tracks number of narrowing vs broadening refinements applied this session */
  narrowCount: number;
  broadCount: number;
}

let lastSearchCache: CachedSearch | null = null;
let lastSearchParams: {
  queries: { query: string; language?: string; license?: string; minStars?: number; sort: string; order: string }[];
  criteria: SearchCriteria;
  userRequest: string;
  filters?: { language?: string | null; license?: string | null; minStars?: number };
  page: number;
  lastPage: number; // GitHub API caps at page 100 (1000 results)
} | null = null;
/** How many ranked repos have been served to the frontend so far */
let lastServedIndex = 0;
let searchGeneration = 0;

/** Abort controllers keyed by generation — abort superseded searches mid-flight. */
const searchAbortControllers = new Map<number, AbortController>();

function abortPriorSearch(gen: number): void {
  for (const [existingGen, controller] of searchAbortControllers) {
    if (existingGen !== gen) {
      controller.abort();
      searchAbortControllers.delete(existingGen);
    }
  }
}

function getOllamaClient(cfg?: AppSettings) {
  const c = cfg ?? settings.load();
  return new OllamaClient(c.ollamaBaseUrl);
}

function getGitHubClient(cfg?: AppSettings) {
  const c = cfg ?? settings.load();
  return new GitHubClient(c.githubToken);
}

async function cachedSearchRepos(github: GitHubClient, params: { query: string; language?: string; license?: string; minStars?: number; sort?: string; order?: string; perPage?: number; page?: number }, signal?: AbortSignal) {
  const key = buildSearchCacheKey(params);
  const cached = searchCache.get(key);
  if (cached) {
    return { repos: cached.repos, totalCount: cached.totalCount, rateLimitRemaining: -1 };
  }
  const result = await github.searchRepos(params as import('../shared/types').SearchParams, signal);
  searchCache.set(key, result.repos, result.totalCount);
  return result;
}

// ── Suggestion post-processing helpers ──

/** Tokenizes a user query into keyword search terms.
 *  Returns the broadest search-friendly phrase as the first element (used for GitHub query),
 *  plus optional shorter sub-phrases for ranking criteria. */
function extractFastKeywords(text: string): string[] {
  // Preserve meaningful tech punctuation: / (CI/CD), - (self-hosted), + (C++), . (Next.js)
  // Only strip punctuation that GitHub search doesn't handle: commas, parens, quotes, etc.
  const cleaned = text.toLowerCase()
    .replace(/[^\w\s\/\-\+\.]/g, ' ')   // keep / - + .
    .replace(/\s+/g, ' ')
    .trim();

  // Remove common stopwords that add noise to GitHub search queries.
  // GitHub search treats each word as required, so "with" in "CI/CD with Docker"
  // becomes a mandatory term that filters out relevant repos.
  //
  // Two categories:
  // 1. Function words (with, for, the, ...) — syntactic glue, no search value
  // 2. Generic nouns (platform, server, tool, ...) — too broad for GitHub API;
  //    a repo about CI/CD may not contain the word "platform" in its name/description,
  //    so requiring it silently filters out relevant results.
  const STOPWORDS = new Set([
    // Function words
    'with', 'for', 'the', 'and', 'that', 'this', 'from', 'into', 'using', 'need', 'want', 'like', 'looking',
    // Generic nouns — too broad to be useful as mandatory GitHub match terms
    'platform', 'server', 'tool', 'system', 'manager', 'service', 'support',
    'application', 'solution', 'software',
  ]);
  // Defense-in-depth: also filter Vietnamese stop-words so they don't leak
  // through if quickVietnameseTranslate() misses any (e.g. proper Vietnamese
  // prepositions not in the dictionary that extractFastKeywords would treat
  // as mandatory GitHub AND-match terms).
  const isVi = VIETNAMESE_STOP_WORDS.size > 0; // always true, but signals intent
  const words = cleaned.split(' ').filter((w) => {
    if (w.length < 2) return false;
    if (STOPWORDS.has(w)) return false;
    if (isVi && VIETNAMESE_STOP_WORDS.has(w)) return false;
    return true;
  });
  if (words.length === 0) return [text.trim()];

  // Phase 1 query: send the broadest distinctive keywords, not ALL words.
  // GitHub search requires ALL terms in results; too many terms = zero results.
  // Strategy: cap at 2-3 distinctive keywords, preferring compound terms.
  let queryWords = words;
  if (words.length > 3) {
    // Prefer compound terms (contain / - + .) as they're most specific
    const compounds = words.filter((w) => /[\/\-\+\.]/.test(w));
    const simple = words.filter((w) => !/[\/\-\+\.]/.test(w));
    if (compounds.length >= 1) {
      // Keep up to 2 compound terms — they narrow results dramatically.
      // Adding a 3rd compound usually makes the query too restrictive.
      const keep = Math.min(compounds.length, 2);
      queryWords = [...compounds.slice(0, keep)];
      // Fill remaining slots with the most important simple terms
      const remaining = 3 - queryWords.length;
      if (remaining > 0 && simple.length > 0) {
        queryWords = [...queryWords, ...simple.slice(0, remaining)];
      }
    } else {
      // No compounds — use first 3 words (most important per natural language)
      queryWords = words.slice(0, 3);
    }
  }

  // Always return the full phrase first — this is what gets sent to GitHub API.
  const phrases = [queryWords.join(' ')];
  // Sub-phrases for ranking criteria
  if (words.length > 3) {
    phrases.push(words.join(' '));
  }
  return phrases;
}

/** Returns true if the query is a single technology/ecosystem name that doesn't need LLM analysis. */
const SIMPLE_TECHS = new Set([
  'python', 'javascript', 'typescript', 'go', 'golang', 'rust', 'java', 'kotlin',
  'swift', 'ruby', 'php', 'scala', 'elixir', 'haskell', 'clojure', 'dart',
  'lua', 'zig', 'nim', 'crystal', 'c++', 'c#', 'r', 'perl', 'shell', 'bash',
  'react', 'vue', 'angular', 'svelte', 'next.js', 'nextjs', 'nuxt',
  'django', 'flask', 'fastapi', 'rails', 'express', 'spring', 'laravel',
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
  'grafana', 'prometheus', 'jenkins', 'github actions', 'gitlab ci',
  'redis', 'postgresql', 'postgres', 'mysql', 'mongodb', 'sqlite',
  'tailwind', 'bootstrap', 'webpack', 'vite', 'esbuild',
  'machine learning', 'deep learning', 'nlp', 'computer vision',
]);

function isSimpleQuery(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[^\w\s.-]/g, '').trim();
  return SIMPLE_TECHS.has(cleaned);
}

/** Merges near-duplicate search queries to avoid redundant API calls. */
function deduplicateSimilarQueries<T extends { query: string }>(params: T[]): T[] {
  if (params.length <= 2) return params;
  const result: T[] = [];
  // Pre-normalize all query words to avoid redundant work per comparison
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
      const union = new Set([...a, ...b]).size;
      if (overlap / union >= 0.5) { isDup = true; break; }
    }
    if (!isDup) result.push(p);
  }
  return result;
}

const STOP_WORDS_DEDUP = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of',
  'is', 'it', 'as', 'at', 'be', 'by', 'me', 'my', 'we', 'our', 'this',
  'that', 'more', 'less', 'only', 'show', 'try', 'use', 'prefer', 'filter',
  'switch', 'move', 'focus', 'keep', 'remove', 'add', 'based', 'tools', 'projects',
]);

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    // Preserve tech-significant punctuation (/-+. in compound terms like ci/cd, self-hosted, c++)
    // before splitting. Strip only non-structural punctuation (parens, quotes, commas).
    .replace(/[^\w\s\/\-\+\.]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS_DEDUP.has(w));
}

/** #6: Removes near-duplicate suggestions within the batch using Jaccard similarity. */
function deduplicateBatch(suggestions: string[]): string[] {
  const result: string[] = [];
  // Pre-normalize to avoid repeated string processing in O(n^2) comparisons
  const normCache = new Map<string, string[]>();
  const getWords = (s: string) => {
    if (!normCache.has(s)) normCache.set(s, normalizeWords(s));
    return normCache.get(s)!;
  };
  for (const s of suggestions) {
    const words = getWords(s);
    let isDuplicate = false;
    for (const existing of result) {
      const existingWords = getWords(existing);
      const overlap = words.filter((w) => existingWords.includes(w)).length;
      if (overlap === 0) continue;
      const union = new Set([...words, ...existingWords]).size;
      const jaccard = overlap / union;
      if (jaccard >= 0.33) { isDuplicate = true; break; }
      if (overlap >= 1 && (words.length === 1 || existingWords.length === 1)) {
        isDuplicate = true; break;
      }
    }
    if (!isDuplicate) result.push(s);
  }
  return result;
}

const LANG_KEYWORDS = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'swift', 'ruby', 'php', 'scala', 'elixir', 'haskell', 'clojure', 'dart', 'lua', 'zig', 'c++', 'c#'];
const LICENSE_KEYWORDS = ['mit', 'apache', 'gpl', 'bsd', 'mpl', 'lgpl', 'agpl', 'unlicense', 'isc'];

/** #5: Ensures suggestion diversity — each dimension bucket gets at least one suggestion. */
function guaranteeCoverage(suggestions: string[], repos: GitHubRepo[]): string[] {
  if (suggestions.length >= 5) return suggestions; // already diverse enough

  const lower = suggestions.map((s) => s.toLowerCase());

  const hasLang = lower.some((s) => LANG_KEYWORDS.some((k) => s.includes(k)));
  const hasLicense = lower.some((s) => LICENSE_KEYWORDS.some((k) => s.includes(k)));
  const hasQuality = lower.some((s) =>
    /stars?|popular|above|over|more than|\d+k/i.test(s)
  );
  const hasRecency = lower.some((s) =>
    /recent|active|newest|latest|updated|maintained/i.test(s)
  );

  // Fill missing language bucket
  if (!hasLang && !hasLicense && !hasQuality && !hasRecency) return suggestions;

  if (!hasLang && repos.length > 0) {
    const langCount = new Map<string, number>();
    for (const r of repos) {
      if (r.language) langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1);
    }
    const sorted = [...langCount.entries()].sort((a, b) => b[1] - a[1]);
    // Pick the top language not already suggested implicitly
    const topLang = sorted.find(([lang]) =>
      !lower.some((s) => s.includes(lang.toLowerCase()))
    );
    if (topLang && sorted.length >= 2) {
      suggestions.push(`only ${topLang[0]} projects`);
    }
  }

  // Fill missing license bucket
  if (!hasLicense && repos.length > 0) {
    const licCount = new Map<string, number>();
    for (const r of repos) {
      const k = r.license?.key ?? 'none';
      licCount.set(k, (licCount.get(k) ?? 0) + 1);
    }
    const sorted = [...licCount.entries()]
      .filter(([k]) => k !== 'none')
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      suggestions.push(`only ${sorted[0][0].toUpperCase()}-licensed`);
    }
  }

  // Fill missing quality bucket
  if (!hasQuality && repos.length > 0) {
    const stars = repos.map((r) => r.stars).sort((a, b) => a - b);
    const median = stars[Math.floor(stars.length / 2)];
    if (median >= 100) {
      suggestions.push(`above ${median.toLocaleString()} stars`);
    }
  }

  // Fill missing recency bucket
  if (!hasRecency && repos.length > 0) {
    suggestions.push('only recently updated');
  }

  return suggestions.slice(0, 6);
}

export function registerIpcHandlers(): void {
  // Pre-warm Ollama connection on startup — establishes TCP/TLS handshake
  // in the background so the first search doesn't pay the connection cost.
  getOllamaClient().checkConnection().catch(() => {});

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    try {
      const cfg = settings.load();
      return { ok: true, data: cfg };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, newSettings) => {
    try {
      settings.save(newSettings);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.OLLAMA_CHECK, async (_event, baseUrl?: string) => {
    try {
      const client = baseUrl ? new OllamaClient(baseUrl) : getOllamaClient();
      const status = await client.checkConnection();
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.OLLAMA_MODELS, async () => {
    try {
      const models = await getOllamaClient().listModels();
      return { ok: true, data: models };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.GITHUB_CHECK, async (_event, token?: string) => {
    try {
      const t = token ?? settings.load().githubToken;
      const client = new GitHubClient(t);
      const result = await client.checkToken();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.SEARCH, async (_event, userRequest: string, filters?: { language?: string | null; license?: string | null; minStars?: number }) => {
    const gen = ++searchGeneration;
    const perf = createPerformanceTracker();
    perf.start();
    perf.beginPhase('phase1');

    // Abort any prior in-flight search
    abortPriorSearch(gen);

    // Create abort controller for this search
    const ac = new AbortController();
    searchAbortControllers.set(gen, ac);

    try {
      const cfg = settings.load();
      const ollama = getOllamaClient(cfg);
      const github = getGitHubClient(cfg);
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);

      // ── Fast-path: skip LLM for simple atomic queries ──
      if (isSimpleQuery(userRequest)) {
        // Vietnamese simple-query fix: translate before sending to GitHub API.
        // Without this, Vietnamese function words become mandatory AND-match terms.
        let simpleQuery = userRequest;
        if (detectVietnamese(userRequest) >= 0.3) {
          const translated = quickVietnameseTranslate(userRequest);
          if (translated) simpleQuery = translated;
        }

        // Use raw query directly as keywords — no LLM needed
        const simpleKeywords = [simpleQuery.trim()];
        const simpleCriteria: SearchCriteria = {
          keywords: simpleKeywords,
          technologies: [],
          intent: 'other',
          useCase: userRequest,
          minStars: 0,
          preferredLicense: null,
          requireRecentActivity: false,
        };

        const fastKeywords = extractFastKeywords(simpleQuery);
        const fastSearchParams = {
          query: fastKeywords[0],
          language: filters?.language ?? undefined,
          minStars: filters?.minStars ?? 0,
          license: filters?.license ?? undefined,
          sort: 'stars' as const, order: 'desc' as const, perPage: 10,
        };

        const simpleSearchResult = await cachedSearchRepos(github, fastSearchParams, ac.signal);
        console.log(`[search] Simple query: "${fastKeywords[0]}" → ${simpleSearchResult.repos.length} repos (total: ${simpleSearchResult.totalCount})`);
        if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

        const repos = simpleSearchResult.repos;
        if (repos.length === 0) {
          return { ok: true, data: { results: [], totalSearched: 0, note: 'No repositories matched.' } };
        }

        const ranked = await rankingEngine.rank(repos, simpleCriteria, new Map(), userRequest, 50);
        const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
          repo, readme: null, score,
          matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
          requestContext: userRequest,
        }));

        lastSearchCache = { repos, readmes: new Map(), originalCriteria: simpleCriteria, originalRequest: userRequest, narrowCount: 0, broadCount: 0 };

        return { ok: true, data: { results, totalSearched: repos.length, suggestions: [] } };
      }

      // ── Phase 1: fast keyword search — return immediately ──
      // Vietnamese Phase 1 fix: translate Vietnamese text before extracting fast keywords.
      // Without this, Vietnamese function words (tôi, muốn, cho) become mandatory GitHub
      // match terms, producing zero results for Vietnamese queries.
      let phase1Query = userRequest;
      const viConfidence = detectVietnamese(userRequest);
      const isVietnamesePhase1 = viConfidence >= 0.3;
      if (isVietnamesePhase1) {
        const translated = quickVietnameseTranslate(userRequest);
        if (translated) {
          phase1Query = translated;
        }
      }
      const fastKeywords = extractFastKeywords(phase1Query);
      // Use only the first (most comprehensive) phrase as query.
      // Joining all phrases into one query creates a monster string with
      // repeated terms that GitHub API interprets as requiring ALL words,
      // which returns zero results for anything but the most trivial queries.
      const fastSearchParams = {
        query: fastKeywords[0],
        language: filters?.language ?? undefined,
        minStars: filters?.minStars ?? 0,
        license: filters?.license ?? undefined,
        sort: 'stars' as const,
        order: 'desc' as const,
        perPage: 10,
      };

      perf.beginPhase('github');
      const fastSearchResult = await cachedSearchRepos(github, fastSearchParams, ac.signal);
      perf.endPhase('github');
      // Debug: log the Phase 1 query and result count to help diagnose "no results" issues
      console.log(`[search] Phase 1 query: "${fastKeywords[0]}" → ${fastSearchResult.repos.length} repos (total: ${fastSearchResult.totalCount})`);

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // Vietnamese zero-recall rescue: if Phase 1 returned nothing but the query
      // was Vietnamese, don't return empty right away — fall through to Phase 2
      // which can produce a proper English query via LLM. Without this, any
      // Vietnamese query that our local dictionary didn't fully translate gets
      // stuck at 0 results forever.
      const viZeroRecall = isVietnamesePhase1 && fastSearchResult.repos.length === 0;
      if (fastSearchResult.repos.length === 0 && !viZeroRecall) {
        return { ok: true, data: { results: [], totalSearched: 0, note: 'No repositories matched.' } };
      }

      // When Vietnamese Phase 1 has zero recall, skip pointless ranking of empty
      // results and produce an empty fastResults array. Phase 2 (async) will do
      // LLM-powered search and push real results via IPC RESULTS_UPDATE.
      const fastResults: GitHubSearchResult[] = viZeroRecall ? [] : await (async () => {
        const fastCriteria: SearchCriteria = {
          keywords: fastKeywords.slice(0, 3),
          technologies: [],
          intent: 'other',
          useCase: userRequest,
          minStars: 0,
          preferredLicense: null,
          requireRecentActivity: false,
        };

        perf.beginPhase('ranking');
        const fastRanked = await rankingEngine.rank(fastSearchResult.repos, fastCriteria, new Map(), userRequest, 50);
        perf.endPhase('ranking');

        // Save state so future scroll-reveal and searchMore work
        lastSearchCache = {
          repos: fastRanked.map(r => r.repo),
          readmes: new Map(),
          originalCriteria: fastCriteria,
          originalRequest: userRequest,
          narrowCount: 0,
          broadCount: 0,
        };
        lastServedIndex = fastRanked.slice(0, 10).length;

        return fastRanked.slice(0, 10).map(({ repo, score }) => ({
          repo,
          readme: null,
          score,
          matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
          requestContext: userRequest,
        }));
      })();

      // ── Unified search: run Phase 2 (LLM enrichment) inline and return once ──
      // Instead of returning Phase 1 immediately and pushing Phase 2 via IPC (which causes
      // results to change after initial display), we await Phase 2 and return unified results.
      // The renderer shows a loading spinner during search; this just extends that spinner
      // until enriched results are ready.

      // Vietnamese zero-recall rescue: if Phase 1 returned nothing but the query
      // was Vietnamese, skip Phase 1 ranking and go straight to Phase 2.
      if (viZeroRecall) {
        // No Phase 1 results to show — fall through to Phase 2 directly
      }

      // Detect Vietnamese ONCE and share the result with extractCriteria and expander
      const isVietnamese = isVietnamesePhase1;

      let criteria: SearchCriteria;
      const cachedCriteria = criteriaCache.get(userRequest);
      if (cachedCriteria) {
        criteria = cachedCriteria;
      } else {
        try {
          perf.beginPhase('ollama');
          // Pass pre-computed Vietnamese flag to avoid redundant detectVietnamese() call
          criteria = await qg.extractCriteria(userRequest, ac.signal, isVietnamese);
          perf.endPhase('ollama');
        } catch {
          // LLM failed — return Phase 1 results as fallback
          perf.endPhase('ollama');
          const criteriaMetrics = criteriaCache.getMetrics();
          const searchMetrics = searchCache.getMetrics();
          const readmeMetrics = github.getReadmeCacheMetrics();
          perf.setCacheMetrics({
            criteriaHits: criteriaMetrics.hits, criteriaMisses: criteriaMetrics.misses, criteriaSize: criteriaMetrics.size,
            searchHits: searchMetrics.hits, searchMisses: searchMetrics.misses, searchSize: searchMetrics.size,
            readmeHits: readmeMetrics.hits, readmeMisses: readmeMetrics.misses, readmeSize: readmeMetrics.size,
          });
          perf.endPhase('phase1');
          const timings = perf.getTimings();
          return { ok: true, data: { results: fastResults, totalSearched: viZeroRecall ? 0 : fastSearchResult.repos.length, suggestions: [], timings } };
        }
        criteriaCache.set(userRequest, criteria);
      }

      // Vietnamese expansion — only when extractCriteria didn't already produce a translation
      if (isVietnamese && !criteria.englishTranslation) {
        try {
          perf.beginPhase('vietnamese');
          const expander = new VietnameseQueryExpander(ollama, cfg.ollamaModel);
          const expansion = await expander.expand(userRequest, ac.signal, translationCache, viConfidence);
          perf.endPhase('vietnamese');
          if (expansion) {
            criteria = {
              ...criteria,
              englishTranslation: expansion.englishTranslation ?? criteria.englishTranslation,
              originalQuery: expansion.originalQuery ?? criteria.originalQuery,
              technicalConcepts: [
                ...(criteria.technicalConcepts ?? []),
                ...expansion.technicalConcepts,
              ].filter((v, i, a) => a.indexOf(v) === i),
              keywords: [
                ...criteria.keywords,
                ...expansion.searchVariants.filter((v: string) => !criteria.keywords.includes(v)),
              ].slice(0, 6),
            };
          }
        } catch { /* best-effort */ }
      }

      // ── Vietnamese enrichment: deterministically add tech terms, synonyms, intent ──
      if (isVietnamese) {
        try {
          const structured = quickVietnameseTranslateStructured(userRequest);
          if (structured) {
            const mergedTechConcepts = [
              ...(criteria.technicalConcepts ?? []),
              ...structured.techTerms,
            ].filter((v, i, a) => a.indexOf(v) === i);

            const mergedExpandedKeywords = [
              ...(criteria.expandedKeywords ?? []),
              ...structured.expandedKeywords,
            ].filter((v, i, a) => a.indexOf(v) === i);

            const mergedIntent = (criteria.intent === 'other' || !criteria.intent) && structured.intent
              ? structured.intent
              : criteria.intent;

            criteria = {
              ...criteria,
              technicalConcepts: mergedTechConcepts,
              expandedKeywords: mergedExpandedKeywords,
              intent: mergedIntent,
            };
          }
        } catch { /* best-effort enrichment, never block search */ }
      }

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // Build LLM queries + dedup
      let allParams = qg.buildSearchParamsArray(criteria, filters);
      allParams = deduplicateSimilarQueries(allParams) as typeof allParams;

      // ── Breadth recovery: add a broad query using only the most distinctive compound terms ──
      const compoundKeywords = criteria.keywords
        .map(k => k.toLowerCase())
        .filter(k => /[\/\-\+\.]/.test(k))
        .slice(0, 2);
      if (compoundKeywords.length >= 1) {
        const broadQuery = compoundKeywords.join(' ');
        const isDuplicateOfExisting = allParams.some(p =>
          p.query.toLowerCase().replace(/[^\w\s]/g, '').trim() === broadQuery.replace(/[^\w\s]/g, '').trim()
        );
        if (!isDuplicateOfExisting) {
          allParams.push({
            query: broadQuery,
            language: filters?.language ?? undefined,
            minStars: filters?.minStars ?? criteria.minStars,
            license: filters?.license ?? criteria.preferredLicense ?? undefined,
            sort: 'stars' as const,
            order: 'desc' as const,
            perPage: 10,
          });
        }
      }

      // Fire all LLM-generated queries with bounded concurrency
      const githubConcurrency = cfg.githubToken ? 5 : 3;
      const searchResults = await boundedAllSettled(
        allParams.map((params) => () => cachedSearchRepos(github, params, ac.signal)),
        githubConcurrency,
      );

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // Merge fast keyword repos + LLM repos
      const successfulResults = searchResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof github.searchRepos>>> => r.status === 'fulfilled')
        .map((r) => r.value);

      // Include fast results in the merge
      successfulResults.push(fastSearchResult);

      const repoMap = new Map<number, GitHubRepo>();
      let totalCount = 0;
      for (const result of successfulResults) {
        totalCount += result.totalCount;
        for (const repo of result.repos) {
          const existing = repoMap.get(repo.id);
          if (!existing || repo.stars > existing.stars) {
            repoMap.set(repo.id, repo);
          }
        }
      }
      const repos = [...repoMap.values()];

      // If all searches returned nothing, return empty results
      if (repos.length === 0 && !viZeroRecall) {
        // Even LLM queries found nothing — try returning Phase 1 results if any
        if (fastResults.length > 0) {
          return { ok: true, data: { results: fastResults, totalSearched: fastSearchResult.repos.length, suggestions: [], timings: perf.getTimings() } };
        }
        return { ok: true, data: { results: [], totalSearched: 0, suggestions: [], timings: perf.getTimings() } };
      }

      // ── Pre-rank fetch: get READMEs for top candidates by stars ──
      const README_PREFETCH_TOP_N = 20;
      const topCandidates = repos.length > 0
        ? [...repos].sort((a, b) => b.stars - a.stars).slice(0, README_PREFETCH_TOP_N)
        : [];

      perf.beginPhase('readme');
      const readmeEntries = topCandidates.length > 0
        ? await boundedAllSettled(
            topCandidates.map(repo => () => github.getReadme(
              repo.full_name.split('/')[0],
              repo.full_name.split('/')[1],
              repo.default_branch,
              repo.id,
              ac.signal,
            )),
            githubConcurrency,
          )
        : [];
      const readmes = new Map<number, string | null>();
      topCandidates.forEach((repo, i) => {
        const entry = readmeEntries[i];
        if (entry?.status === 'fulfilled') {
          readmes.set(repo.id, entry.value);
        }
      });
      perf.endPhase('readme');

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // Rank with enriched criteria + README-enriched readmes map
      const ranked = repos.length > 0
        ? await rankingEngine.rank(repos, criteria, readmes, userRequest, 50)
        : [];

      const enrichedResults: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
        requestContext: userRequest,
      }));

      // Update caches
      lastSearchCache = {
        repos: ranked.map(r => r.repo),
        readmes,
        originalCriteria: criteria,
        originalRequest: userRequest,
        narrowCount: 0,
        broadCount: 0,
      };
      lastServedIndex = enrichedResults.length;
      lastSearchParams = {
        queries: allParams.map(p => ({ query: p.query, language: p.language, license: p.license, minStars: p.minStars, sort: p.sort, order: p.order })),
        criteria,
        userRequest: userRequest,
        filters,
        page: 1,
        lastPage: Math.min(Math.ceil(totalCount / 10), Math.ceil(1000 / 10)),
      };

      // Collect cache metrics
      const criteriaMetrics = criteriaCache.getMetrics();
      const searchMetrics = searchCache.getMetrics();
      const readmeMetrics = github.getReadmeCacheMetrics();
      perf.setCacheMetrics({
        criteriaHits: criteriaMetrics.hits, criteriaMisses: criteriaMetrics.misses, criteriaSize: criteriaMetrics.size,
        searchHits: searchMetrics.hits, searchMisses: searchMetrics.misses, searchSize: searchMetrics.size,
        readmeHits: readmeMetrics.hits, readmeMisses: readmeMetrics.misses, readmeSize: readmeMetrics.size,
      });
      perf.endPhase('phase1'); // phase1 timing now covers the whole unified search

      // Fire-and-forget suggestions — these arrive via separate IPC and don't replace results
      const scoreValues = ranked.map(r => r.score.total * 100).sort((a, b) => a - b);
      const scorePercentiles = scoreValues.length > 0 ? {
        top: Math.round(scoreValues[scoreValues.length - 1]),
        median: Math.round(scoreValues[Math.floor(scoreValues.length / 2)]),
        bottom: Math.round(scoreValues[0]),
        above80: scoreValues.filter(s => s >= 80).length,
        below50: scoreValues.filter(s => s < 50).length,
        total: scoreValues.length,
      } : undefined;

      Promise.resolve().then(async () => {
        try {
          perf.beginPhase('suggestion');
          const candidates = await qg.generateRefinementSuggestions(
            userRequest, criteria.keywords, criteria.technologies, criteria.intent,
            repos.length, repos, scorePercentiles, undefined,
          );
          perf.endPhase('suggestion');
          const validator = new RefinementValidator();
          const result = validator.validate(candidates, repos, {
            language: filters?.language ?? null,
            license: filters?.license ?? null,
            minStars: filters?.minStars ?? 0,
          });
          let final = deduplicateBatch(result.valid);
          final = guaranteeCoverage(final, repos);
          if (searchGeneration === gen) {
            _event.sender.send(IPC.SUGGESTIONS_UPDATE, { suggestions: final });
          }
        } catch {
          perf.endPhase('suggestion');
          /* silently ignore */
        }
      }).catch(() => {});

      return { ok: true, data: { results: enrichedResults.slice(0, 10), totalSearched: repos.length, suggestions: [], timings: perf.getTimings() } };
    } catch (err) {
      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      // Clean up abort controller for completed/superseded searches
      if (searchAbortControllers.get(gen) === ac) {
        searchAbortControllers.delete(gen);
      }
    }
  });

  // ── Refinement ──
  ipcMain.handle(IPC.SEARCH_REFINE, async (_event, refinementText: string) => {
    const gen = ++searchGeneration;
    abortPriorSearch(gen);

    const ac = new AbortController();
    searchAbortControllers.set(gen, ac);

    try {
      if (!lastSearchCache) {
        return { ok: false, error: 'No search to refine. Run a search first.' };
      }

      const cfg = settings.load();

      // ── Fast-path: detect deterministic patterns, skip LLM ──
      const parser = new RefinementParser();
      const detected = parser.detect(refinementText);

      if (detected?.type === 'raw-sort') {
        // Direct sort — no LLM, instant result
        const repos = [...lastSearchCache.repos];
        const sortKey = detected.sortKey!;
        const desc = detected.sortDesc ?? true;

        repos.sort((a, b) => {
          if (sortKey === 'stars') return desc ? b.stars - a.stars : a.stars - b.stars;
          if (sortKey === 'forks') return desc ? b.forks - a.forks : a.forks - b.forks;
          if (sortKey === 'updated_at') {
            const da = new Date(a.updated_at).getTime();
            const db = new Date(b.updated_at).getTime();
            return desc ? db - da : da - db;
          }
          return 0;
        });

        const sorted = repos.slice(0, 50);
        const sortedContext = `${lastSearchCache.originalRequest} (sorted: ${refinementText})`;
        const results: GitHubSearchResult[] = sorted.map((repo) => ({
          repo,
          readme: lastSearchCache!.readmes.get(repo.id) ?? null,
          score: {
            total: 0, semanticMatch: 0, starsScore: 0,
            activityScore: 0, readmeRelevance: 0,
            languageMatch: 0, licenseCompatibility: 0,
          },
          matchExplanation: `Sorted by ${sortKey.replace('_', ' ')}`,
          requestContext: sortedContext,
        }));

        return {
          ok: true,
          data: {
            results,
            totalSearched: lastSearchCache.repos.length,
            note: `Sorted by ${detected.sortKey!.replace('_', ' ')}: "${refinementText}"`,
          },
        };
      }

      // ── Emphasis fast-path: detected weight profile, skip LLM ──
      if (detected?.type === 'emphasis') {
        const ranked = await rankingEngine.rank(
          lastSearchCache.repos,
          lastSearchCache.originalCriteria,
          lastSearchCache.readmes,
          lastSearchCache.originalRequest,
          50,
          detected.emphasis,
        );

        const rankedContext = `${lastSearchCache.originalRequest} (refined: ${refinementText})`;
        const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
          repo,
          readme: lastSearchCache!.readmes.get(repo.id) ?? null,
          score,
          matchExplanation: `Score: ${Math.round(score.total * 100)}% match (refined)`,
          requestContext: rankedContext,
        }));

        return {
          ok: true,
          data: {
            results,
            totalSearched: lastSearchCache.repos.length,
            note: `Re-ranked with refinement: "${refinementText}"`,
          },
        };
      }

      // ── LLM fallback: pass to Ollama for full criteria refinement ──
      const ollama = getOllamaClient(cfg);
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);

      let refinedCriteria: SearchCriteria;
      try {
        refinedCriteria = await qg.refineCriteria(
          lastSearchCache.originalCriteria,
          refinementText,
          lastSearchCache.originalRequest,
        );
      } catch (llmErr) {
        if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
        const message = llmErr instanceof Error ? llmErr.message : String(llmErr);
        return { ok: false, error: `Refinement analysis failed: ${message}` };
      }

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const ranked = await rankingEngine.rank(
        lastSearchCache.repos,
        refinedCriteria,
        lastSearchCache.readmes,
        lastSearchCache.originalRequest,
        50,
        refinedCriteria.weightEmphasis,
      );

      const refinedContext = `${lastSearchCache.originalRequest} (refined: ${refinementText})`;
      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: lastSearchCache!.readmes.get(repo.id) ?? null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match (refined)`,
        requestContext: refinedContext,
      }));

      return {
        ok: true,
        data: {
          results,
          totalSearched: lastSearchCache.repos.length,
          note: `Re-ranked with refinement: "${refinementText}"`,
        },
      };
    } catch (err) {
      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (searchAbortControllers.get(gen) === ac) {
        searchAbortControllers.delete(gen);
      }
    }
  });

  // ── Load More: serve from ranked cache first, then paginate GitHub API ──
  ipcMain.handle(IPC.SEARCH_MORE, async () => {
    if (!lastSearchParams || !lastSearchCache) {
      return { ok: false, error: 'No search to load more from. Run a search first.' };
    }

    // ── Serve from in-memory cache first (already-ranked repos we haven't sent yet) ──
    const BATCH_SIZE = 10;
    if (lastServedIndex < lastSearchCache.repos.length) {
      const nextBatch = lastSearchCache.repos.slice(lastServedIndex, lastServedIndex + BATCH_SIZE);
      lastServedIndex += nextBatch.length;

      const results: GitHubSearchResult[] = nextBatch.map((repo) => ({
        repo,
        readme: null, // READMEs fetched lazily
        score: { total: 0, semanticMatch: 0, starsScore: 0, activityScore: 0, readmeRelevance: 0, languageMatch: 0, licenseCompatibility: 0 },
        matchExplanation: 'Cached result',
        requestContext: lastSearchParams!.userRequest,
      }));

      const moreAvailable = lastServedIndex < lastSearchCache.repos.length || lastSearchParams.page < lastSearchParams.lastPage;

      return {
        ok: true,
        data: {
          results,
          moreAvailable,
          totalSearched: lastSearchCache.repos.length,
        },
      };
    }

    // ── Cache exhausted — fetch next page from GitHub API ──
    if (lastSearchParams.page >= lastSearchParams.lastPage) {
      return { ok: true, data: { results: [] as GitHubSearchResult[], moreAvailable: false, totalSearched: lastSearchCache.repos.length } };
    }

    const nextPage = lastSearchParams.page + 1;
    const github = getGitHubClient(settings.load());

    try {
      // Only re-query the top (highest-yield) query for pagination — not all queries.
      // This avoids 3-6 redundant GitHub API calls per "load more" action.
      const topQuery = lastSearchParams.queries[0]; // first query is the broadest/most relevant
      let searchResult: { repos: GitHubRepo[]; totalCount: number; rateLimitRemaining: number };
      try {
        searchResult = await cachedSearchRepos(github, {
          query: topQuery.query,
          language: topQuery.language,
          license: topQuery.license,
          minStars: topQuery.minStars,
          sort: topQuery.sort as 'stars',
          order: topQuery.order as 'desc',
          perPage: 10,
          page: nextPage,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const existingIds = new Set(lastSearchCache.repos.map(r => r.id));
      const newRepos = new Map<number, GitHubRepo>();

      for (const repo of searchResult.repos) {
        if (!existingIds.has(repo.id)) {
          const existing = newRepos.get(repo.id);
          if (!existing || repo.stars > existing.stars) {
            newRepos.set(repo.id, repo);
          }
        }
      }

      if (newRepos.size === 0) {
        return { ok: true, data: { results: [] as GitHubSearchResult[], moreAvailable: false, totalSearched: lastSearchCache.repos.length } };
      }

      const newReposArray = [...newRepos.values()];
      const ranked = await rankingEngine.rank(newReposArray, lastSearchParams.criteria, lastSearchCache.readmes, lastSearchParams.userRequest, 50);

      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: null, // READMEs fetched lazily
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
        requestContext: lastSearchParams!.userRequest,
      }));

      // Update our stored state
      lastSearchParams.page = nextPage;
      for (const repo of newReposArray) {
        lastSearchCache.repos.push(repo);
      }
      lastServedIndex = lastSearchCache.repos.length;

      const moreAvailable = nextPage < lastSearchParams.lastPage;

      return {
        ok: true,
        data: {
          results,
          moreAvailable,
          totalSearched: lastSearchCache.repos.length,
          page: nextPage,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Lazy README fetch (triggered when user opens repo detail) ──
  ipcMain.handle(IPC.GET_README, async (_event, params: { owner: string; repo: string; branch: string; repoId: number }) => {
    try {
      const github = getGitHubClient(settings.load());
      const readme = await github.getReadme(params.owner, params.repo, params.branch, params.repoId);
      return { ok: true, data: { readme } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Explanation (lazy-loaded) ──
  ipcMain.handle(IPC.GENERATE_EXPLANATION, async (_event, params: { repoName: string; repoDescription: string | null; requestContext: string }) => {
    try {
      const cfg = settings.load();
      const ollama = getOllamaClient(cfg);
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);
      const explanation = await qg.generateMatchExplanation(
        params.repoName,
        params.repoDescription,
        params.requestContext,
      );
      return { ok: true, data: { explanation } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Bookmarks ──
  ipcMain.handle(IPC.BOOKMARKS_GET_ALL, async () => {
    try {
      return { ok: true, data: bookmarks.getAll() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BOOKMARKS_ADD, async (_event, bookmark) => {
    try {
      const all = bookmarks.add(bookmark);
      return { ok: true, data: all };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BOOKMARKS_REMOVE, async (_event, repoId: number) => {
    try {
      const all = bookmarks.remove(repoId);
      return { ok: true, data: all };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Clone ──
  ipcMain.handle(IPC.CLONE_REPO, async (_event, repoUrl: string, repoName: string) => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Choose Clone Destination',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Clone Here',
      });

      if (canceled || filePaths.length === 0) {
        return { ok: true, data: { canceled: true } };
      }

      const targetDir = filePaths[0];

      return new Promise((resolve) => {
        const proc = spawn('git', ['clone', repoUrl, repoName], {
          cwd: targetDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ ok: true, data: { canceled: false, success: true, path: `${targetDir}\\${repoName}` } });
          } else {
            // git clone writes progress to stderr, so check if it actually cloned
            if (stderr.includes('Receiving objects') && !stderr.includes('fatal:')) {
              resolve({ ok: true, data: { canceled: false, success: true, path: `${targetDir}\\${repoName}` } });
            } else {
              resolve({ ok: false, error: `Clone failed: ${stderr.slice(-200)}` });
            }
          }
        });

        proc.on('error', (err) => {
          resolve({ ok: false, error: `Failed to start git: ${err.message}. Is git installed?` });
        });
      });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

}
