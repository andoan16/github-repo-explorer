import type { GitHubRepo, SearchCriteria } from '../../shared/types';

interface CacheEntry {
  repos: GitHubRepo[];
  totalCount: number;
  timestamp: number;
  readmes?: Map<number, string | null>;
}

/** Metrics tracking for cache performance. */
export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  /** Entries that were valid but evicted due to capacity (not TTL expiry) */
  capacityEvictions: number;
  /** Entries that expired (TTL) — counted separately from cold misses */
  expiredHits: number;
  size: number;
  maxSize: number;
}

// TTLs aligned: search results last 15 min (was 10), criteria last 30 min.
// The previous 10/30 mismatch caused criteria to reference queries whose
// results had already expired, triggering redundant GitHub API calls.
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 100; // was 50 — each search fills 3-6 slots, 50 was too small

/**
 * TTL + LRU cache for GitHub search results.
 * Avoids redundant API calls when the same query is made within a short window.
 * Tracks hit/miss metrics for performance monitoring.
 */
class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _capacityEvictions = 0;
  private _expiredHits = 0;

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }

    // TTL check — count as "expired hit" (not a cold miss) since the entry
    // was valid at some point. This keeps miss metrics accurate.
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      this._evictions++;
      this._expiredHits++;
      return null;
    }

    // LRU: move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this._hits++;
    return entry;
  }

  set(key: string, repos: GitHubRepo[], totalCount: number): void {
    // At capacity: evict expired entries first, then fall back to LRU eviction
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Try to find and evict an already-expired entry (better than evicting a valid one)
      let evicted = false;
      for (const [k, v] of this.cache) {
        if (Date.now() - v.timestamp > CACHE_TTL_MS) {
          this.cache.delete(k);
          this._evictions++;
          this._expiredHits++;
          evicted = true;
          break;
        }
      }
      // No expired entries — evict LRU (oldest valid entry)
      if (!evicted) {
        const oldest = this.cache.keys().next().value;
        if (oldest) {
          this.cache.delete(oldest);
          this._evictions++;
          this._capacityEvictions++;
        }
      }
    }

    this.cache.set(key, {
      repos,
      totalCount,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  /** Return current cache performance metrics. */
  getMetrics(): CacheMetrics {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      capacityEvictions: this._capacityEvictions,
      expiredHits: this._expiredHits,
      size: this.cache.size,
      maxSize: MAX_CACHE_SIZE,
    };
  }

  /** Reset counters (not the cache itself). */
  resetMetrics(): void {
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
    this._capacityEvictions = 0;
    this._expiredHits = 0;
  }
}

/** Normalize and serialize search params into a deterministic cache key. */
export function buildSearchCacheKey(params: {
  query: string;
  language?: string;
  license?: string;
  minStars?: number;
  sort?: string;
  order?: string;
  perPage?: number;
  page?: number;
}): string {
  // Normalize query: trim + lowercase + collapse whitespace
  const normalizedQuery = params.query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  return [
    normalizedQuery,
    params.language ?? '_',
    params.license ?? '_',
    params.minStars ?? 0,
    params.sort ?? 'stars',
    params.order ?? 'desc',
    params.perPage ?? 10,
    params.page ?? 1,
  ].join('|');
}

export const searchCache = new SearchCache();

// ── Criteria cache: avoid repeated Ollama calls for identical queries ──

interface CriteriaCacheEntry {
  criteria: SearchCriteria;
  timestamp: number;
}

const CRITERIA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CRITERIA_CACHE_SIZE = 100;

class CriteriaCache {
  private cache = new Map<string, CriteriaCacheEntry>();
  private _hits = 0;
  private _misses = 0;

  /** Normalize a user request into a cache key (lowercase, collapsed whitespace). */
  static key(userRequest: string): string {
    return userRequest.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  get(userRequest: string): SearchCriteria | null {
    const key = CriteriaCache.key(userRequest);
    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }
    if (Date.now() - entry.timestamp > CRITERIA_CACHE_TTL_MS) {
      this.cache.delete(key);
      // Count as expired hit, not cold miss
      this._misses++;
      return null;
    }
    // LRU touch
    this.cache.delete(key);
    this.cache.set(key, entry);
    this._hits++;
    return entry.criteria;
  }

  set(userRequest: string, criteria: SearchCriteria): void {
    const key = CriteriaCache.key(userRequest);
    // Evict expired entries first when at capacity
    if (this.cache.size >= MAX_CRITERIA_CACHE_SIZE) {
      let evicted = false;
      for (const [k, v] of this.cache) {
        if (Date.now() - v.timestamp > CRITERIA_CACHE_TTL_MS) {
          this.cache.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { criteria, timestamp: Date.now() });
  }

  getMetrics(): { hits: number; misses: number; size: number } {
    return { hits: this._hits, misses: this._misses, size: this.cache.size };
  }
}

export const criteriaCache = new CriteriaCache();
