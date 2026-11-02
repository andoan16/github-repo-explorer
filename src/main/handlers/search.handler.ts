import { ipcMain } from 'electron';
import { OllamaClient } from '../ollama/client';
import { llmManager } from '../llm/manager';
import type { ILlmClient } from '../llm/types';
import { GitHubClient } from '../github/client';
import { QueryGenerator } from '../search/query-gen';
import { RefinementValidator } from '../search/refinement-validator';
import { RefinementParser } from '../search/refinement-parser';
import { searchCache, buildSearchCacheKey, criteriaCache } from '../search/cache';
import { RankingEngine } from '../ranking/engine';
import { vectorReranker } from '../ranking/vector-reranker';
import { SettingsStore } from '../settings/store';
import {
  IPC,
  type AppSettings,
  type GitHubRepo,
  type GitHubSearchResult,
  type SearchCriteria,
} from '../../shared/types';
import { boundedAllSettled } from '../utils/concurrency';
import { createPerformanceTracker } from '../search/perf';
import {
  VietnameseQueryExpander,
  translationCache,
  detectVietnamese,
  quickVietnameseTranslate,
  quickVietnameseTranslateStructured,
  extractTechTerms,
  VIETNAMESE_STOP_WORDS,
} from '../search/vietnamese';
import { detectAlternativeRequest } from '../search/intent-decomposer';
import { deduplicateBatch, deduplicateSimilarQueries } from '../../shared/search-utils';
import { searchSession } from '../search/search-session';

const rankingEngine = new RankingEngine();

/** Apply client-side minStars filter to repos. */
export function filterByMinStars(repos: GitHubRepo[], minStars?: number): GitHubRepo[] {
  if (!minStars || minStars <= 0) return repos;
  return repos.filter((r) => r.stars >= minStars!);
}

function getLlmClient(cfg?: AppSettings, settings?: SettingsStore): ILlmClient {
  const c = cfg ?? settings?.load();
  if (!c) throw new Error('Settings not provided');
  return llmManager.getClient(c);
}

function getGitHubClient(cfg?: AppSettings, settings?: SettingsStore) {
  const c = cfg ?? settings?.load();
  if (!c) throw new Error('Settings not provided');
  return new GitHubClient(c.githubToken);
}

const inFlightSearches = new Map<string, Promise<{ repos: GitHubRepo[]; totalCount: number; rateLimitRemaining: number }>>();
const inFlightCriteria = new Map<string, Promise<SearchCriteria>>();

async function cachedSearchRepos(
  github: GitHubClient,
  params: {
    query: string;
    language?: string;
    license?: string;
    minStars?: number;
    sort?: string;
    order?: string;
    perPage?: number;
    page?: number;
  },
  signal?: AbortSignal,
) {
  const key = buildSearchCacheKey(params);
  const cached = searchCache.get(key);
  if (cached) {
    return { repos: cached.repos, totalCount: cached.totalCount, rateLimitRemaining: -1 };
  }

  // Single-flight in-flight request coalescing
  const inFlight = inFlightSearches.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = github.searchRepos(params as import('../../shared/types').SearchParams, signal);
  inFlightSearches.set(key, promise);
  try {
    const result = await promise;
    searchCache.set(key, result.repos, result.totalCount);
    return result;
  } finally {
    inFlightSearches.delete(key);
  }
}

export function extractFastKeywords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s\/\-\+\.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const STOPWORDS = new Set([
    'with', 'for', 'the', 'and', 'that', 'this', 'from', 'into', 'using', 'need', 'want', 'like', 'looking',
    'platform', 'server', 'tool', 'system', 'manager', 'service', 'support',
    'application', 'solution', 'software',
  ]);
  const isVi = VIETNAMESE_STOP_WORDS.size > 0;
  const words = cleaned.split(' ').filter((w) => {
    if (w.length < 2) return false;
    if (STOPWORDS.has(w)) return false;
    if (isVi && VIETNAMESE_STOP_WORDS.has(w)) return false;
    return true;
  });
  if (words.length === 0) return [text.trim()];

  let queryWords = words;
  if (words.length > 3) {
    const compounds = words.filter((w) => /[\/\-\+\.]/.test(w));
    const simple = words.filter((w) => !/[\/\-\+\.]/.test(w));
    if (compounds.length >= 1) {
      const keep = Math.min(compounds.length, 2);
      queryWords = [...compounds.slice(0, keep)];
      const remaining = 3 - queryWords.length;
      if (remaining > 0 && simple.length > 0) {
        queryWords = [...queryWords, ...simple.slice(0, remaining)];
      }
    } else {
      queryWords = words.slice(0, 3);
    }
  }

  const phrases = [queryWords.join(' ')];
  if (words.length > 3) {
    phrases.push(words.join(' '));
  }
  return phrases;
}

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

export function isSimpleQuery(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[^\w\s.-]/g, '').trim();
  return SIMPLE_TECHS.has(cleaned);
}

const LANG_KEYWORDS = new Set(['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'swift', 'ruby', 'php', 'scala', 'elixir', 'haskell', 'clojure', 'dart', 'lua', 'zig', 'c++', 'c#']);
const LICENSE_KEYWORDS = new Set(['mit', 'apache', 'gpl', 'bsd', 'mpl', 'lgpl', 'agpl', 'unlicense', 'isc']);

export function guaranteeCoverage(suggestions: string[], repos: GitHubRepo[]): string[] {
  const filtered = suggestions.filter(
    (s) => s.trim().length >= 3 && !/^(suggest(ion)?|example|phrase|query|item|keyword)(\s*\d+)?$/i.test(s.trim()),
  );

  if (filtered.length >= 4) return filtered.slice(0, 6);

  const lower = filtered.map((s) => s.toLowerCase());
  const PUNC_REGEX = /[,().:\-[\]]/g;

  const hasLang = lower.some((s) => {
    const words = s.replace(PUNC_REGEX, ' ').split(' ');
    for (let i = 0; i < words.length; i++) {
      if (LANG_KEYWORDS.has(words[i])) return true;
    }
    return false;
  });
  const hasLicense = lower.some((s) => {
    const words = s.replace(PUNC_REGEX, ' ').split(' ');
    for (let i = 0; i < words.length; i++) {
      if (LICENSE_KEYWORDS.has(words[i])) return true;
    }
    return false;
  });
  const hasQuality = lower.some((s) =>
    /stars?|popular|above|over|more than|\d+k/i.test(s),
  );
  const hasRecency = lower.some((s) =>
    /recent|active|newest|latest|updated|maintained/i.test(s),
  );

  if (filtered.length >= 3 && !hasLang && !hasLicense && !hasQuality && !hasRecency) {
    return filtered;
  }

  if (!hasLang && repos.length > 0) {
    const langCount = new Map<string, number>();
    for (const r of repos) {
      if (r.language) langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1);
    }
    const sorted = [...langCount.entries()].sort((a, b) => b[1] - a[1]);
    const topLang = sorted.find(([lang]) =>
      !lower.some((s) => s.includes(lang.toLowerCase())),
    );
    if (topLang) {
      filtered.push(`only ${topLang[0]} projects`);
    }
  }

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
      filtered.push(`only ${sorted[0][0].toUpperCase()}-licensed`);
    }
  }

  if (!hasQuality && repos.length > 0) {
    const stars = repos.map((r) => r.stars).sort((a, b) => a - b);
    const median = stars[Math.floor(stars.length / 2)];
    if (median >= 100) {
      filtered.push(`above ${median.toLocaleString()} stars`);
    }
  }

  if (!hasRecency && repos.length > 0) {
    filtered.push('only recently updated');
  }

  return filtered.slice(0, 6);
}

function sendRefinementSuggestions(
  sender: Electron.WebContents,
  gen: number,
  qg: QueryGenerator,
  repos: GitHubRepo[],
  userRequest: string,
  criteria: SearchCriteria,
  filters?: { language?: string | null; license?: string | null; minStars?: number } | null,
  feedbackContext?: { narrowCount: number; broadCount: number },
): void {
  Promise.resolve().then(async () => {
    try {
      const rankedRepos = repos.slice(0, 50);
      const scoreValues = rankedRepos.length > 0
        ? rankedRepos.map((r) => {
            const starScore = Math.min(r.stars / 10000, 1) * 100;
            const ageDays = r.updated_at ? (Date.now() - new Date(r.updated_at).getTime()) / 86400000 : 9999;
            const activityScore = Math.max(0, 100 - ageDays / 30);
            return starScore * 0.4 + activityScore * 0.3 + 30;
          }).sort((a, b) => a - b)
        : [];
      const scorePercentiles = scoreValues.length > 0 ? {
        top: Math.round(scoreValues[scoreValues.length - 1]),
        median: Math.round(scoreValues[Math.floor(scoreValues.length / 2)]),
        bottom: Math.round(scoreValues[0]),
        above80: scoreValues.filter((s) => s >= 80).length,
        below50: scoreValues.filter((s) => s < 50).length,
        total: scoreValues.length,
      } : undefined;

      const candidates = await qg.generateRefinementSuggestions(
        userRequest, criteria.keywords, criteria.technologies, criteria.intent,
        rankedRepos.length, rankedRepos, scorePercentiles, feedbackContext,
      );

      const validator = new RefinementValidator();
      const result = validator.validate(candidates, rankedRepos, {
        language: filters?.language ?? null,
        license: filters?.license ?? null,
        minStars: filters?.minStars ?? 0,
      });
      let final = deduplicateBatch(result.valid);
      final = guaranteeCoverage(final, rankedRepos);
      if (searchSession.isCurrentGeneration(gen)) {
        sender.send(IPC.SUGGESTIONS_UPDATE, { suggestions: final });
      }
    } catch (err) {
      console.warn('[suggestions] Failed to generate refinement suggestions:', err);
    }
  }).catch(() => {});
}

export function registerSearchHandlers(settings: SettingsStore): void {
  // ── Unified Search ──
  ipcMain.handle(IPC.SEARCH, async (_event, userRequest: string, filters?: { language?: string | null; license?: string | null; minStars?: number }) => {
    const { gen, controller } = searchSession.startNewSearch();
    const perf = createPerformanceTracker();
    perf.start();
    perf.beginPhase('phase1');

    try {
      const cfg = settings.load();
      const llm = getLlmClient(cfg, settings);
      const github = getGitHubClient(cfg, settings);
      const qg = new QueryGenerator(llm, cfg.ollamaModel);

      let effectiveRequest = userRequest;
      const viConfidence = detectVietnamese(userRequest);
      const isVietnamesePhase1 = viConfidence >= 0.3;
      if (isVietnamesePhase1) {
        const translated = quickVietnameseTranslate(userRequest);
        if (translated) {
          effectiveRequest = translated;
        }
      }

      // Fast-path: simple atomic queries
      if (isSimpleQuery(effectiveRequest)) {
        const simpleKeywords = [effectiveRequest.trim()];
        const simpleCriteria: SearchCriteria = {
          keywords: simpleKeywords,
          technologies: [],
          intent: 'other',
          useCase: userRequest,
          minStars: 0,
          preferredLicense: null,
          requireRecentActivity: false,
        };

        const fastKeywords = extractFastKeywords(effectiveRequest);
        const fastSearchParams = {
          query: fastKeywords[0],
          language: filters?.language ?? undefined,
          minStars: 0,
          license: filters?.license ?? undefined,
          sort: 'stars' as const, order: 'desc' as const, perPage: 10,
        };

        const simpleSearchResult = await cachedSearchRepos(github, fastSearchParams, controller.signal);
        if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

        const repos = filterByMinStars(simpleSearchResult.repos, filters?.minStars);
        if (repos.length === 0) {
          return { ok: true, data: { results: [], totalSearched: 0, note: 'No repositories matched.' } };
        }

        const ranked = await rankingEngine.rank(repos, simpleCriteria, new Map(), userRequest, 50);
        const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
          repo, readme: null, score,
          matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
          requestContext: userRequest,
        }));

        searchSession.setSearchResult({
          repos,
          readmes: new Map(),
          criteria: simpleCriteria,
          userRequest,
          servedCount: repos.length,
        });

        return { ok: true, data: { results, totalSearched: repos.length, suggestions: [] } };
      }

      const altDetection = detectAlternativeRequest(userRequest);
      let fastKeywords = extractFastKeywords(effectiveRequest);
      if (altDetection.isAlternative && altDetection.cleanCoreDomain) {
        fastKeywords = [
          ...(altDetection.suggestedQueries ?? [altDetection.cleanCoreDomain]),
          ...(altDetection.suggestedTopics ?? []),
        ];
      }

      const fastSearchParams = {
        query: fastKeywords[0],
        language: filters?.language ?? undefined,
        minStars: 0,
        license: filters?.license ?? undefined,
        sort: 'stars' as const,
        order: 'desc' as const,
        perPage: 20,
      };

      perf.beginPhase('github');
      const fastSearchResult = await cachedSearchRepos(github, fastSearchParams, controller.signal);
      perf.endPhase('github');

      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

      const phase1Filtered = filterByMinStars(fastSearchResult.repos, filters?.minStars);
      const viZeroRecall = isVietnamesePhase1 && fastSearchResult.repos.length === 0;
      const filterZeroRecall = filters?.minStars && filters.minStars > 0 && phase1Filtered.length === 0 && fastSearchResult.repos.length > 0;
      if (fastSearchResult.repos.length === 0 && !viZeroRecall && !filterZeroRecall) {
        return { ok: true, data: { results: [], totalSearched: 0, note: 'No repositories matched.' } };
      }

      const fastResults: GitHubSearchResult[] = viZeroRecall ? [] : await (async () => {
        const fastCriteria: SearchCriteria = {
          keywords: fastKeywords.slice(0, 3),
          technologies: [],
          intent: altDetection.isAlternative ? 'desktop-app' : 'other',
          useCase: userRequest,
          minStars: 0,
          preferredLicense: null,
          requireRecentActivity: false,
          benchmarkEntity: altDetection.benchmark,
          targetFeatures: altDetection.suggestedFeatures,
          topicTags: altDetection.suggestedTopics,
        };

        perf.beginPhase('ranking');
        const fastRanked = await rankingEngine.rank(phase1Filtered, fastCriteria, new Map(), userRequest, 50);
        perf.endPhase('ranking');

        searchSession.setSearchResult({
          repos: fastRanked.map((r) => r.repo),
          readmes: new Map(),
          criteria: fastCriteria,
          userRequest,
          servedCount: fastRanked.slice(0, 10).length,
        });

        return fastRanked.slice(0, 10).map(({ repo, score }) => ({
          repo,
          readme: null,
          score,
          matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
          requestContext: userRequest,
        }));
      })();

      const isVietnamese = isVietnamesePhase1;
      let criteria: SearchCriteria;
      const normalizedQueryKey = userRequest.trim().toLowerCase();
      const cachedCriteria = criteriaCache.get(normalizedQueryKey) ?? criteriaCache.get(userRequest);
      if (cachedCriteria) {
        criteria = cachedCriteria;
      } else {
        try {
          perf.beginPhase('ollama');
          // In-flight coalescing: reuse active promise if identical query is already extracting
          let criteriaPromise = inFlightCriteria.get(normalizedQueryKey);
          if (!criteriaPromise) {
            criteriaPromise = qg.extractCriteria(userRequest, controller.signal, isVietnamese);
            inFlightCriteria.set(normalizedQueryKey, criteriaPromise);
          }
          try {
            criteria = await criteriaPromise;
          } finally {
            inFlightCriteria.delete(normalizedQueryKey);
          }
          perf.endPhase('ollama');
        } catch (err) {
          console.warn('[search] extractCriteria failed, falling back to Phase 1:', err);
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
          return { ok: true, data: { results: fastResults, totalSearched: viZeroRecall ? 0 : fastSearchResult.repos.length, suggestions: [], timings: perf.getTimings() } };
        }
        criteriaCache.set(userRequest, criteria);
        criteriaCache.set(normalizedQueryKey, criteria);
      }

      if (isVietnamese && !criteria.englishTranslation) {
        try {
          perf.beginPhase('vietnamese');
          const expander = new VietnameseQueryExpander(llm, cfg.ollamaModel);
          const expansion = await expander.expand(userRequest, controller.signal, translationCache, viConfidence);
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

      if (isVietnamese) {
        try {
          const structured = quickVietnameseTranslateStructured(userRequest);
          if (structured) {
            const mergedTechConcepts = [
              ...(criteria.technicalConcepts ?? []),
              ...structured.techTerms,
            ].filter((v, i, a) => a.indexOf(v) === i);

            const mergedExpandedKeywords = (criteria.expandedKeywords?.length ?? 0) > 0
              ? criteria.expandedKeywords!
              : structured.expandedKeywords;

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
        } catch { /* best-effort */ }
      }

      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

      let allParams = qg.buildSearchParamsArray(criteria, filters);
      allParams = deduplicateSimilarQueries(allParams) as typeof allParams;

      const compoundKeywords = criteria.keywords
        .map((k) => k.toLowerCase())
        .filter((k) => /[\/\-\+\.]/.test(k))
        .slice(0, 2);
      if (compoundKeywords.length >= 1) {
        const broadQuery = compoundKeywords.join(' ');
        const isDuplicateOfExisting = allParams.some((p) =>
          p.query.toLowerCase().replace(/[^\w\s]/g, '').trim() === broadQuery.replace(/[^\w\s]/g, '').trim(),
        );
        if (!isDuplicateOfExisting) {
          allParams.push({
            query: broadQuery,
            language: filters?.language ?? undefined,
            minStars: 0,
            license: filters?.license ?? criteria.preferredLicense ?? undefined,
            sort: 'stars' as const,
            order: 'desc' as const,
            perPage: 10,
          });
        }
      }

      if (altDetection.isAlternative && altDetection.suggestedQueries) {
        const altParams: typeof allParams = [];
        for (const sq of altDetection.suggestedQueries) {
          altParams.push({
            query: sq,
            language: filters?.language ?? undefined,
            minStars: 0,
            license: filters?.license ?? criteria.preferredLicense ?? undefined,
            sort: 'stars' as const,
            order: 'desc' as const,
            perPage: 20,
          });
        }
        for (const p of allParams) {
          const isDupe = altParams.some((ap) => ap.query.toLowerCase().trim() === p.query.toLowerCase().trim());
          if (!isDupe) {
            altParams.push(p);
          }
        }
        allParams = altParams;
      }

      if (!cfg.githubToken && allParams.length > 4) {
        allParams = allParams.slice(0, 4);
      }

      const githubConcurrency = cfg.githubToken ? 5 : 3;
      const searchResults = await boundedAllSettled(
        allParams.map((params) => () => cachedSearchRepos(github, params, controller.signal)),
        githubConcurrency,
        controller.signal,
      );

      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

      const successfulResults = searchResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof github.searchRepos>>> => r.status === 'fulfilled')
        .map((r) => r.value);

      if (!viZeroRecall) {
        successfulResults.push(fastSearchResult);
      }

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
      const filteredRepos = filterByMinStars(repos, filters?.minStars);

      if (filteredRepos.length === 0 && !viZeroRecall) {
        if (fastResults.length > 0) {
          return { ok: true, data: { results: fastResults, totalSearched: phase1Filtered.length, suggestions: [], timings: perf.getTimings() } };
        }
        return { ok: true, data: { results: [], totalSearched: 0, suggestions: [], timings: perf.getTimings() } };
      }

      // ── Adaptive README Prefetch: top 15 if authenticated, top 5 if unauthenticated ──
      const README_PREFETCH_TOP_N = cfg.githubToken ? 15 : 5;
      const topCandidates = filteredRepos.length > 0
        ? [...filteredRepos].sort((a, b) => b.stars - a.stars).slice(0, README_PREFETCH_TOP_N)
        : [];

      perf.beginPhase('readme');
      const readmeEntries = topCandidates.length > 0
        ? await boundedAllSettled(
            topCandidates.map((repo) => () => github.getReadme(
              repo.full_name.split('/')[0],
              repo.full_name.split('/')[1],
              repo.default_branch,
              repo.id,
              controller.signal,
            )),
            githubConcurrency,
            controller.signal,
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

      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

      let vectorScores: Map<number, number> | undefined;
      if (filteredRepos.length > 0) {
        try {
          perf.beginPhase('ranking');
          const semanticQuery = altDetection.isAlternative
            ? `open-source alternative to ${altDetection.benchmark || 'commercial software'} with ${altDetection.suggestedFeatures?.slice(0, 5).join(' ')} ${altDetection.cleanCoreDomain || 'tools'}`
            : (criteria.englishTranslation || criteria.useCase || userRequest);
          vectorScores = await vectorReranker.rerankCandidates(
            semanticQuery,
            filteredRepos.slice(0, 30),
            readmes,
            llm,
            controller.signal,
          );
        } catch (err) {
          console.warn('[vector-reranking] Reranking skipped:', err);
        }
      }

      const ranked = filteredRepos.length > 0
        ? await rankingEngine.rank(filteredRepos, criteria, readmes, userRequest, 50, undefined, vectorScores)
        : [];

      const enrichedResults: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
        requestContext: userRequest,
      }));

      searchSession.setSearchResult({
        repos: ranked.map((r) => r.repo),
        readmes,
        criteria,
        userRequest,
        servedCount: enrichedResults.length,
        searchParams: {
          queries: allParams.map((p) => ({ query: p.query, language: p.language, license: p.license, minStars: p.minStars, sort: p.sort, order: p.order })),
          criteria,
          userRequest,
          filters,
          page: 1,
          lastPage: Math.min(Math.ceil(totalCount / 10), Math.ceil(1000 / 10)),
        },
      });

      const criteriaMetrics = criteriaCache.getMetrics();
      const searchMetrics = searchCache.getMetrics();
      const readmeMetrics = github.getReadmeCacheMetrics();
      perf.setCacheMetrics({
        criteriaHits: criteriaMetrics.hits, criteriaMisses: criteriaMetrics.misses, criteriaSize: criteriaMetrics.size,
        searchHits: searchMetrics.hits, searchMisses: searchMetrics.misses, searchSize: searchMetrics.size,
        readmeHits: readmeMetrics.hits, readmeMisses: readmeMetrics.misses, readmeSize: readmeMetrics.size,
      });
      perf.endPhase('phase1');

      sendRefinementSuggestions(
        _event.sender, gen, qg, filteredRepos,
        userRequest, criteria, filters, undefined,
      );

      searchSession.logSearchResults(userRequest, criteria, allParams, ranked, enrichedResults.slice(0, 10).length);

      return { ok: true, data: { results: enrichedResults.slice(0, 10), totalSearched: filteredRepos.length, suggestions: [], timings: perf.getTimings() } };
    } catch (err) {
      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      searchSession.cleanupGeneration(gen, controller);
    }
  });

  // ── Refinement ──
  ipcMain.handle(IPC.SEARCH_REFINE, async (_event, refinementText: string) => {
    const { gen, controller } = searchSession.startNewSearch();
    const sender = _event.sender;

    try {
      const lastSearch = searchSession.getCache();
      if (!lastSearch) {
        return { ok: false, error: 'No search to refine. Run a search first.' };
      }

      const cfg = settings.load();
      const isNarrowing = RefinementParser.isNarrowing(refinementText);
      const parser = new RefinementParser();
      const detected = parser.detect(refinementText);

      const sendSuggestionsFor = (refinedRepos: GitHubRepo[]) => {
        const llm = getLlmClient(cfg, settings);
        const qg = new QueryGenerator(llm, cfg.ollamaModel);
        sendRefinementSuggestions(
          sender, gen, qg, refinedRepos,
          lastSearch.originalRequest, lastSearch.originalCriteria,
          null,
          { narrowCount: lastSearch.narrowCount, broadCount: lastSearch.broadCount },
        );
      };

      if (detected?.type === 'raw-sort') {
        const repos = [...lastSearch.repos];
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
        const sortedContext = `${lastSearch.originalRequest} (sorted: ${refinementText})`;
        const results: GitHubSearchResult[] = sorted.map((repo) => ({
          repo,
          readme: lastSearch.readmes.get(repo.id) ?? null,
          score: {
            total: 0, semanticMatch: 0, starsScore: 0,
            activityScore: 0, readmeRelevance: 0,
            languageMatch: 0, licenseCompatibility: 0,
          },
          matchExplanation: `Sorted by ${sortKey.replace('_', ' ')}`,
          requestContext: sortedContext,
        }));

        searchSession.updateRefinedRepos(sorted, isNarrowing);
        sendSuggestionsFor(sorted);

        return {
          ok: true,
          data: {
            results,
            totalSearched: lastSearch.repos.length,
            note: `Sorted by ${detected.sortKey!.replace('_', ' ')}: "${refinementText}"`,
          },
        };
      }

      if (detected?.type === 'filter' && detected.minStars !== undefined) {
        const filtered = lastSearch.repos.filter((r) => r.stars >= detected.minStars!);
        if (filtered.length === 0) {
          return {
            ok: false,
            error: `No repositories found with ${detected.minStars!.toLocaleString()}+ stars. Try a lower threshold.`,
          };
        }

        const ranked = await rankingEngine.rank(
          filtered,
          lastSearch.originalCriteria,
          lastSearch.readmes,
          lastSearch.originalRequest,
          50,
          { semanticMatch: 1.0, starsScore: 2.0, activityScore: 1.0, readmeRelevance: 0.8, languageMatch: 1.0, licenseCompatibility: 1.0 },
        );

        if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

        const filterContext = `${lastSearch.originalRequest} (filtered: ${refinementText})`;
        const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
          repo,
          readme: lastSearch.readmes.get(repo.id) ?? null,
          score,
          matchExplanation: `${detected.minStars!.toLocaleString()}+ stars (filtered)`,
          requestContext: filterContext,
        }));

        searchSession.updateRefinedRepos(ranked.map((r) => r.repo), isNarrowing);
        sendSuggestionsFor(ranked.map((r) => r.repo));

        return {
          ok: true,
          data: {
            results,
            totalSearched: filtered.length,
            note: `Filtered to ${detected.minStars!.toLocaleString()}+ stars: "${refinementText}"`,
            minStars: detected.minStars,
          },
        };
      }

      if (detected?.type === 'emphasis') {
        const ranked = await rankingEngine.rank(
          lastSearch.repos,
          lastSearch.originalCriteria,
          lastSearch.readmes,
          lastSearch.originalRequest,
          50,
          detected.emphasis,
        );

        if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

        const rankedContext = `${lastSearch.originalRequest} (refined: ${refinementText})`;
        const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
          repo,
          readme: lastSearch.readmes.get(repo.id) ?? null,
          score,
          matchExplanation: `Score: ${Math.round(score.total * 100)}% match (refined)`,
          requestContext: rankedContext,
        }));

        searchSession.updateRefinedRepos(ranked.map((r) => r.repo), isNarrowing);
        sendSuggestionsFor(ranked.map((r) => r.repo));

        return {
          ok: true,
          data: {
            results,
            totalSearched: lastSearch.repos.length,
            note: `Re-ranked with refinement: "${refinementText}"`,
          },
        };
      }

      const llm = getLlmClient(cfg, settings);
      const qg = new QueryGenerator(llm, cfg.ollamaModel);

      let refinedCriteria: SearchCriteria;
      try {
        refinedCriteria = await qg.refineCriteria(
          lastSearch.originalCriteria,
          refinementText,
          lastSearch.originalRequest,
        );
      } catch (llmErr) {
        console.warn('[refinement] LLM refinement failed, applying heuristic fallback:', llmErr);
        const newTech = extractTechTerms(refinementText);
        refinedCriteria = {
          ...lastSearch.originalCriteria,
          keywords: [
            ...lastSearch.originalCriteria.keywords,
            refinementText.slice(0, 40),
          ].slice(0, 5),
          technologies: [
            ...lastSearch.originalCriteria.technologies,
            ...newTech,
          ].filter((v, i, a) => a.indexOf(v) === i),
          weightEmphasis: {
            semanticMatch: 1.3,
            starsScore: 1.0,
            activityScore: 1.0,
            readmeRelevance: 1.3,
            languageMatch: newTech.length > 0 ? 1.5 : 1.0,
            licenseCompatibility: 1.0,
          },
        };
      }

      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

      let vectorScores: Map<number, number> | undefined;
      try {
        const queryText = refinedCriteria.englishTranslation || refinedCriteria.useCase || lastSearch.originalRequest;
        vectorScores = await vectorReranker.rerankCandidates(
          queryText,
          lastSearch.repos.slice(0, 30),
          lastSearch.readmes,
          llm,
        );
      } catch { /* best effort */ }

      const ranked = await rankingEngine.rank(
        lastSearch.repos,
        refinedCriteria,
        lastSearch.readmes,
        lastSearch.originalRequest,
        50,
        refinedCriteria.weightEmphasis,
        vectorScores,
      );

      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };

      const refinedContext = `${lastSearch.originalRequest} (refined: ${refinementText})`;
      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: lastSearch.readmes.get(repo.id) ?? null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match (refined)`,
        requestContext: refinedContext,
      }));

      searchSession.updateRefinedRepos(ranked.map((r) => r.repo), isNarrowing);
      sendRefinementSuggestions(
        sender, gen, qg, ranked.map((r) => r.repo),
        lastSearch.originalRequest, lastSearch.originalCriteria,
        null,
        { narrowCount: lastSearch.narrowCount, broadCount: lastSearch.broadCount },
      );

      return {
        ok: true,
        data: {
          results,
          totalSearched: lastSearch.repos.length,
          note: `Re-ranked with refinement: "${refinementText}"`,
        },
      };
    } catch (err) {
      if (!searchSession.isCurrentGeneration(gen)) return { ok: false, error: 'Search superseded' };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      searchSession.cleanupGeneration(gen, controller);
    }
  });

  // ── Load More (Pagination) ──
  ipcMain.handle(IPC.SEARCH_MORE, async () => {
    const lastSearch = searchSession.getCache();
    const lastParams = searchSession.getSearchParams();
    if (!lastParams || !lastSearch) {
      return { ok: false, error: 'No search to load more from. Run a search first.' };
    }

    const cachedBatch = searchSession.serveNextCachedBatch(10);
    if (cachedBatch) {
      const results: GitHubSearchResult[] = cachedBatch.repos.map((repo) => ({
        repo,
        readme: null,
        score: { total: 0, semanticMatch: 0, starsScore: 0, activityScore: 0, readmeRelevance: 0, languageMatch: 0, licenseCompatibility: 0 },
        matchExplanation: 'Cached result',
        requestContext: lastParams.userRequest,
      }));

      return {
        ok: true,
        data: {
          results,
          moreAvailable: cachedBatch.moreAvailable,
          totalSearched: lastSearch.repos.length,
        },
      };
    }

    if (lastParams.page >= lastParams.lastPage) {
      return { ok: true, data: { results: [] as GitHubSearchResult[], moreAvailable: false, totalSearched: lastSearch.repos.length } };
    }

    const nextPage = lastParams.page + 1;
    const genBeforeFetch = searchSession.getCurrentGeneration();
    const github = getGitHubClient(settings.load(), settings);

    try {
      const topQuery = lastParams.queries[0];
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
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Failed to load more: ${message}` };
      }

      if (searchSession.getCurrentGeneration() !== genBeforeFetch) {
        return { ok: false, error: 'Search superseded — results from previous search are no longer valid.' };
      }

      const minStarsFilter = lastParams.filters?.minStars;
      const filteredSearchRepos = filterByMinStars(searchResult.repos, minStarsFilter);
      const existingIds = new Set(lastSearch.repos.map((r) => r.id));
      const newRepos = new Map<number, GitHubRepo>();

      for (const repo of filteredSearchRepos) {
        if (!existingIds.has(repo.id)) {
          const existing = newRepos.get(repo.id);
          if (!existing || repo.stars > existing.stars) {
            newRepos.set(repo.id, repo);
          }
        }
      }

      if (newRepos.size === 0) {
        return { ok: true, data: { results: [] as GitHubSearchResult[], moreAvailable: false, totalSearched: lastSearch.repos.length } };
      }

      const newReposArray = [...newRepos.values()];
      const ranked = await rankingEngine.rank(newReposArray, lastParams.criteria, lastSearch.readmes, lastParams.userRequest, 50);

      if (searchSession.getCurrentGeneration() !== genBeforeFetch) {
        return { ok: false, error: 'Search superseded — results from previous search are no longer valid.' };
      }

      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
        requestContext: lastParams.userRequest,
      }));

      searchSession.appendPaginatedRepos(newReposArray, nextPage);
      const moreAvailable = nextPage < lastParams.lastPage;

      return {
        ok: true,
        data: {
          results,
          moreAvailable,
          totalSearched: lastSearch.repos.length,
          page: nextPage,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Lazy README fetch ──
  const SAFE_GITHUB_IDENTIFIER_RE = /^[A-Za-z0-9_.-]+$/;

  ipcMain.handle(IPC.GET_README, async (_event, params: { owner: string; repo: string; branch: string; repoId: number }) => {
    try {
      if (!params || typeof params.owner !== 'string' || typeof params.repo !== 'string') {
        return { ok: false, error: 'Invalid parameters: owner and repo must be strings' };
      }
      if (!SAFE_GITHUB_IDENTIFIER_RE.test(params.owner) || !SAFE_GITHUB_IDENTIFIER_RE.test(params.repo)) {
        return { ok: false, error: 'Invalid parameters: owner and repo contain invalid characters' };
      }
      const github = getGitHubClient(settings.load(), settings);
      const readme = await github.getReadme(params.owner, params.repo, params.branch, params.repoId);
      return { ok: true, data: { readme } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Explanation ──
  ipcMain.handle(IPC.GENERATE_EXPLANATION, async (_event, params: { repoName: string; repoDescription: string | null; requestContext: string }) => {
    try {
      const cfg = settings.load();
      const llm = getLlmClient(cfg, settings);
      const qg = new QueryGenerator(llm, cfg.ollamaModel);
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
}
