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
import { IPC, type GitHubRepo, type GitHubSearchResult, type SearchCriteria, type SearchTimings } from '../shared/types';
import { boundedAllSettled } from './utils/concurrency';
import { createPerformanceTracker } from './search/perf';

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

function getOllamaClient() {
  const cfg = settings.load();
  return new OllamaClient(cfg.ollamaBaseUrl);
}

function getGitHubClient() {
  const cfg = settings.load();
  return new GitHubClient(cfg.githubToken);
}

async function cachedSearchRepos(github: GitHubClient, params: { query: string; language?: string; license?: string; minStars?: number; sort?: string; order?: string; perPage?: number }, signal?: AbortSignal) {
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

/** Tokenizes a user query into keyword search terms. */
function extractFastKeywords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return [text.trim()];
  const phrases = [words.join(' ')];
  if (words.length >= 4) {
    phrases.push(words.slice(0, 3).join(' '));
    phrases.push(words.slice(Math.max(0, words.length - 3)).join(' '));
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
  for (const p of params) {
    let isDup = false;
    for (const existing of result) {
      const a = normalizeWords(p.query);
      const b = normalizeWords(existing.query);
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
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS_DEDUP.has(w));
}

/** #6: Removes near-duplicate suggestions within the batch using Jaccard similarity. */
function deduplicateBatch(suggestions: string[]): string[] {
  const result: string[] = [];
  for (const s of suggestions) {
    const words = normalizeWords(s);
    let isDuplicate = false;
    for (const existing of result) {
      const existingWords = normalizeWords(existing);
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

    // Abort any prior in-flight search
    abortPriorSearch(gen);

    // Create abort controller for this search
    const ac = new AbortController();
    searchAbortControllers.set(gen, ac);

    try {
      const cfg = settings.load();
      const ollama = getOllamaClient();
      const github = getGitHubClient();
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);

      // ── Fast-path: skip LLM for simple atomic queries ──
      if (isSimpleQuery(userRequest)) {
        // Use raw query directly as keywords — no LLM needed
        const simpleKeywords = [userRequest.trim()];
        const simpleCriteria: SearchCriteria = {
          keywords: simpleKeywords,
          technologies: [],
          intent: 'other',
          useCase: userRequest,
          minStars: 0,
          preferredLicense: null,
          requireRecentActivity: false,
        };

        const fastKeywords = extractFastKeywords(userRequest);
        const fastSearchParams = {
          query: fastKeywords.join(' '),
          language: filters?.language ?? undefined,
          minStars: filters?.minStars ?? 0,
          license: filters?.license ?? undefined,
          sort: 'stars' as const, order: 'desc' as const, perPage: 30,
        };

        const simpleSearchResult = await cachedSearchRepos(github, fastSearchParams, ac.signal);
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

      // ── Normal path: LLM criteria extraction + fast keyword GitHub search ──
      const fastKeywords = extractFastKeywords(userRequest);
      const fastSearchParams = {
        query: fastKeywords.join(' '),
        language: filters?.language ?? undefined,
        minStars: filters?.minStars ?? 0,
        license: filters?.license ?? undefined,
        sort: 'stars' as const,
        order: 'desc' as const,
        perPage: 30,
      };

      let criteria: SearchCriteria;

      // ── Check criteria cache before calling Ollama ──
      const cachedCriteria = criteriaCache.get(userRequest);

      if (cachedCriteria) {
        criteria = cachedCriteria;
        // Skip Ollama — use cached criteria directly
      } else {
        perf.beginPhase('ollama');
        const [criteriaResult, fastSearchResult] = await Promise.allSettled([
          qg.extractCriteria(userRequest, ac.signal),
          cachedSearchRepos(github, fastSearchParams, ac.signal),
        ]);
        perf.endPhase('ollama');

        // ── Fallback: LLM failed → use fast keywords + fast results ──
        if (criteriaResult.status === 'rejected') {
          if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
          // Fall back to fast keyword results if available
          if (fastSearchResult.status === 'fulfilled' && fastSearchResult.value.repos.length > 0) {
            criteria = {
              keywords: fastKeywords.slice(0, 3),
              technologies: [],
              intent: 'other',
              useCase: userRequest,
              minStars: 0,
              preferredLicense: null,
              requireRecentActivity: false,
            };
            const ranked = await rankingEngine.rank(fastSearchResult.value.repos, criteria, new Map(), userRequest, 50);
            const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
              repo, readme: null, score,
              matchExplanation: `Score: ${Math.round(score.total * 100)}% match (quick)`,
              requestContext: userRequest,
            }));
            lastSearchCache = { repos: fastSearchResult.value.repos, readmes: new Map(), originalCriteria: criteria, originalRequest: userRequest, narrowCount: 0, broadCount: 0 };
            return { ok: true, data: { results, totalSearched: fastSearchResult.value.repos.length, note: 'Quick results — LLM unavailable, using keyword search.' } };
          }
          const err = criteriaResult.reason;
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, error: `Ollama query analysis failed: ${message}.` };
        }
        criteria = criteriaResult.value;
        // Cache criteria for future identical queries
        criteriaCache.set(userRequest, criteria);
      }

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // Build LLM-generated queries
      let allParams = qg.buildSearchParamsArray(criteria, filters);

      // ── Deduplicate similar queries ──
      allParams = deduplicateSimilarQueries(allParams) as typeof allParams;

      // Include fast keyword search in parallel with LLM-generated queries
      const searchResults = await Promise.allSettled(
        allParams.map((params) => github.searchRepos(params, ac.signal)),
      );

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const failedQueries = searchResults.filter((r) => r.status === 'rejected').length;
      const successfulResults = searchResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof github.searchRepos>>> => r.status === 'fulfilled')
        .map((r) => r.value);

      if (successfulResults.length === 0) {
        const firstError = (searchResults[0] as PromiseRejectedResult).reason;
        const message = firstError instanceof Error ? firstError.message : String(firstError);
        return { ok: false, error: `GitHub search failed: ${message}` };
      }

      // Merge and deduplicate by repo ID (keep higher stars on collision)
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

      if (repos.length === 0) {
        return {
          ok: true,
          data: {
            results: [],
            totalSearched: 0,
            queryUsed: criteria.keywords.join(' | '),
            note: 'No repositories matched. Try broadening your description or reducing filter constraints.',
          },
        };
      }

      // ── Stage 1: metadata-only ranking (no READMEs yet) ──
      const emptyReadmes = new Map<number, string | null>();
      const stage1Ranked = await rankingEngine.rank(repos, criteria, emptyReadmes, userRequest, 50);

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // ── Fetch READMEs for top candidates only (bounded concurrency) ──
      const README_CANDIDATES = 10;
      const topForReadmes = stage1Ranked.slice(0, README_CANDIDATES);
      const readmes = new Map<number, string | null>();

      await boundedAllSettled(
        topForReadmes.map((item) => async () => {
          try {
            const [owner, name] = item.repo.full_name.split('/');
            const readme = await github.getReadme(owner, name, item.repo.default_branch, item.repo.id, ac.signal);
            readmes.set(item.repo.id, readme);
          } catch {
            readmes.set(item.repo.id, null);
          }
        }),
        8,
      );

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      // ── Stage 2: re-rank with README enrichment ──
      const ranked = await rankingEngine.rank(repos, criteria, readmes, userRequest, 50);

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: readmes.get(repo.id) ?? null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
        requestContext: userRequest,
      }));

      const note = failedQueries > 0
        ? `${failedQueries}/${allParams.length} search queries failed; showing results from ${successfulResults.length} queries.`
        : undefined;

      lastSearchCache = { repos, readmes, originalCriteria: criteria, originalRequest: userRequest, narrowCount: 0, broadCount: 0 };

      // ── Fire-and-forget refinement suggestions via IPC push ──
      const scoreValues = ranked.map((r) => r.score.total * 100).sort((a, b) => a - b);
      const scorePercentiles = scoreValues.length > 0 ? {
        top: Math.round(scoreValues[scoreValues.length - 1]),
        median: Math.round(scoreValues[Math.floor(scoreValues.length / 2)]),
        bottom: Math.round(scoreValues[0]),
        above80: scoreValues.filter((s) => s >= 80).length,
        below50: scoreValues.filter((s) => s < 50).length,
        total: scoreValues.length,
      } : undefined;

      // Capture variables for closure
      const capturedQ = qg;
      const capturedUserReq = userRequest;
      const capturedKeys = criteria.keywords;
      const capturedTechs = criteria.technologies;
      const capturedIntent = criteria.intent;
      const capturedRepos = repos;
      const capturedFilters = filters;
      const capturedGen = gen;

      Promise.resolve().then(async () => {
        if (searchGeneration !== capturedGen) return;
        try {
          const candidates = await capturedQ.generateRefinementSuggestions(
            capturedUserReq, capturedKeys, capturedTechs, capturedIntent,
            capturedRepos.length, capturedRepos, scorePercentiles, undefined,
          );
          const validator = new RefinementValidator();
          const result = validator.validate(candidates, capturedRepos, {
            language: capturedFilters?.language ?? null,
            license: capturedFilters?.license ?? null,
            minStars: capturedFilters?.minStars ?? 0,
          });
          let final = deduplicateBatch(result.valid);
          final = guaranteeCoverage(final, capturedRepos);
          _event.sender.send(IPC.SUGGESTIONS_UPDATE, { suggestions: final });
        } catch {
          // Silently ignore
        }
      });

      return { ok: true, data: { results, totalSearched: repos.length, note, suggestions: [] } };
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
      const ollama = getOllamaClient();
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

  // ── Explanation (lazy-loaded) ──
  ipcMain.handle(IPC.GENERATE_EXPLANATION, async (_event, params: { repoName: string; repoDescription: string | null; requestContext: string }) => {
    try {
      const cfg = settings.load();
      const ollama = getOllamaClient();
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
