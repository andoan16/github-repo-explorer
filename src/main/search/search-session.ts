import { app } from 'electron';
import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { GitHubRepo, SearchCriteria, RelevanceScore } from '../../shared/types';

export interface CachedSearch {
  repos: GitHubRepo[];
  readmes: Map<number, string | null>;
  originalCriteria: SearchCriteria;
  originalRequest: string;
  /** Tracks number of narrowing vs broadening refinements applied this session */
  narrowCount: number;
  broadCount: number;
}

export interface LastSearchParams {
  queries: { query: string; language?: string; license?: string; minStars?: number; sort: string; order: string }[];
  criteria: SearchCriteria;
  userRequest: string;
  filters?: { language?: string | null; license?: string | null; minStars?: number };
  page: number;
  lastPage: number;
}

export class SearchSessionManager {
  private currentGeneration = 0;
  private abortControllers = new Map<number, AbortController>();
  private lastSearchCache: CachedSearch | null = null;
  private lastSearchParams: LastSearchParams | null = null;
  private lastServedIndex = 0;

  /**
   * Starts a new search generation, aborting any prior in-flight searches.
   */
  startNewSearch(): { gen: number; controller: AbortController } {
    const gen = ++this.currentGeneration;
    this.abortPriorSearches(gen);

    const controller = new AbortController();
    this.abortControllers.set(gen, controller);
    return { gen, controller };
  }

  /**
   * Checks if a given generation is still active and not superseded.
   */
  isCurrentGeneration(gen: number): boolean {
    return this.currentGeneration === gen;
  }

  getCurrentGeneration(): number {
    return this.currentGeneration;
  }

  /**
   * Aborts all search controllers except the active one.
   */
  abortPriorSearches(activeGen: number): void {
    for (const [gen, controller] of this.abortControllers) {
      if (gen !== activeGen) {
        controller.abort();
        this.abortControllers.delete(gen);
      }
    }
  }

  /**
   * Cleans up the abort controller for a completed generation.
   */
  cleanupGeneration(gen: number, controller: AbortController): void {
    if (this.abortControllers.get(gen) === controller) {
      this.abortControllers.delete(gen);
    }
  }

  /**
   * Saves the unified search results to memory cache.
   */
  setSearchResult(params: {
    repos: GitHubRepo[];
    readmes: Map<number, string | null>;
    criteria: SearchCriteria;
    userRequest: string;
    servedCount: number;
    searchParams?: LastSearchParams;
  }): void {
    this.lastSearchCache = {
      repos: params.repos,
      readmes: params.readmes,
      originalCriteria: params.criteria,
      originalRequest: params.userRequest,
      narrowCount: 0,
      broadCount: 0,
    };
    this.lastServedIndex = params.servedCount;
    if (params.searchParams) {
      this.lastSearchParams = params.searchParams;
    }
  }

  getCache(): CachedSearch | null {
    return this.lastSearchCache;
  }

  getSearchParams(): LastSearchParams | null {
    return this.lastSearchParams;
  }

  setSearchParams(params: LastSearchParams | null): void {
    this.lastSearchParams = params;
  }

  getServedIndex(): number {
    return this.lastServedIndex;
  }

  setServedIndex(index: number): void {
    this.lastServedIndex = index;
  }

  /**
   * Updates cached repos after sorting, filtering, or emphasis refinement.
   */
  updateRefinedRepos(repos: GitHubRepo[], isNarrowing?: boolean): void {
    if (!this.lastSearchCache) return;
    if (isNarrowing !== undefined) {
      if (isNarrowing) this.lastSearchCache.narrowCount++;
      else this.lastSearchCache.broadCount++;
    }
    this.lastSearchCache = {
      ...this.lastSearchCache,
      repos,
    };
  }

  /**
   * Serves the next batch of repos from in-memory cache if available.
   */
  serveNextCachedBatch(batchSize = 10): { repos: GitHubRepo[]; moreAvailable: boolean } | null {
    if (!this.lastSearchCache || !this.lastSearchParams) return null;
    if (this.lastServedIndex >= this.lastSearchCache.repos.length) return null;

    const nextBatch = this.lastSearchCache.repos.slice(this.lastServedIndex, this.lastServedIndex + batchSize);
    this.lastServedIndex += nextBatch.length;

    const moreAvailable =
      this.lastServedIndex < this.lastSearchCache.repos.length ||
      this.lastSearchParams.page < this.lastSearchParams.lastPage;

    return { repos: nextBatch, moreAvailable };
  }

  /**
   * Appends newly fetched paginated repos to the current cache.
   */
  appendPaginatedRepos(newRepos: GitHubRepo[], nextPage: number): void {
    if (!this.lastSearchCache || !this.lastSearchParams) return;
    this.lastSearchParams.page = nextPage;
    for (const repo of newRepos) {
      this.lastSearchCache.repos.push(repo);
    }
    this.lastServedIndex = this.lastSearchCache.repos.length;
  }

  /**
   * Logs search results to a debug file for offline analysis.
   */
  logSearchResults(
    userRequest: string,
    criteria: SearchCriteria,
    allParams: { query: string }[],
    ranked: { repo: GitHubRepo; score: RelevanceScore }[],
    servedCount: number,
  ): void {
    try {
      const logDir = join(app.getPath('userData'), 'logs');
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true, mode: 0o700 });
      const logPath = join(logDir, 'search-debug-log.txt');

      if (existsSync(logPath)) {
        try {
          const stats = statSync(logPath);
          if (stats.size > 5 * 1024 * 1024) {
            writeFileSync(logPath, '', { mode: 0o600 });
          }
        } catch (_) {}
      }

      const now = new Date();
      const ts = now.toISOString();
      const lines: string[] = [];

      lines.push('═'.repeat(80));
      lines.push(`[${ts}] Search: "${userRequest}"`);
      lines.push('─'.repeat(80));
      lines.push(`Intent: ${criteria.intent}`);
      lines.push(`Keywords: ${JSON.stringify(criteria.keywords)}`);
      lines.push(`Technologies: ${JSON.stringify(criteria.technologies)}`);
      if (criteria.englishTranslation) lines.push(`English translation: ${criteria.englishTranslation}`);
      if (criteria.technicalConcepts?.length) lines.push(`Technical concepts: ${JSON.stringify(criteria.technicalConcepts)}`);
      if (criteria.expandedKeywords?.length) lines.push(`Expanded keywords: ${JSON.stringify(criteria.expandedKeywords)}`);
      if (criteria.originalQuery) lines.push(`Original Vietnamese: "${criteria.originalQuery}"`);
      lines.push('');
      lines.push(`GitHub queries (${allParams.length}):`);
      allParams.forEach((p, i) => lines.push(`  ${i + 1}. "${p.query}"`));
      lines.push('');
      lines.push(`Ranked results (showing top ${Math.min(servedCount, ranked.length)} of ${ranked.length}):`);
      ranked.slice(0, servedCount).forEach((r, i) => {
        const repo = r.repo;
        const score = r.score;
        lines.push(`  #${i + 1} ${repo.full_name} (★${repo.stars})`);
        lines.push(`       Score: total=${score.total} semantic=${score.semanticMatch} stars=${score.starsScore} activity=${score.activityScore} readme=${score.readmeRelevance} lang=${score.languageMatch} license=${score.licenseCompatibility}`);
        lines.push(`       Desc: ${(repo.description ?? 'no description').slice(0, 120)}`);
        lines.push(`       Topics: ${JSON.stringify(repo.topics)}`);
        lines.push(`       Lang: ${repo.language ?? 'n/a'} | Updated: ${repo.updated_at} | License: ${repo.license?.key ?? 'none'}`);
      });
      lines.push('');
      lines.push('');

      appendFileSync(logPath, lines.join('\n'), { encoding: 'utf-8', mode: 0o600 });
    } catch (err) {
      console.error('[search-debug] Failed to log results:', err);
    }
  }
}

export const searchSession = new SearchSessionManager();
