import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SearchCache,
  CriteriaCache,
  buildSearchCacheKey,
} from '../../src/main/search/cache';

describe('Cache tests', () => {
  describe('buildSearchCacheKey', () => {
    it('normalizes spaces and lowercases', () => {
      const key = buildSearchCacheKey({ query: '   HelLO   woRld  ' });
      expect(key).toBe('hello world|_|_|0|stars|desc|10|1');
    });

    it('uses provided parameters', () => {
      const key = buildSearchCacheKey({
        query: 'test',
        language: 'typescript',
        license: 'mit',
        minStars: 100,
        sort: 'updated',
        order: 'asc',
        perPage: 25,
        page: 2,
      });
      expect(key).toBe('test|typescript|mit|100|updated|asc|25|2');
    });
  });

  describe('SearchCache', () => {
    let cache: SearchCache;

    beforeEach(() => {
      vi.useFakeTimers();
      cache = new SearchCache();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sets and gets entries', () => {
      const repos: any[] = [{ name: 'test' }];
      cache.set('key1', repos, 10);

      const entry = cache.get('key1');
      expect(entry).not.toBeNull();
      expect(entry?.repos).toBe(repos);
      expect(entry?.totalCount).toBe(10);

      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(0);
    });

    it('returns null for missing keys', () => {
      const entry = cache.get('missing');
      expect(entry).toBeNull();

      const metrics = cache.getMetrics();
      expect(metrics.misses).toBe(1);
    });

    it('evicts expired entries on get', () => {
      const repos: any[] = [{ name: 'test' }];
      cache.set('key1', repos, 10);

      // Advance time by 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      const entry = cache.get('key1');
      expect(entry).toBeNull();

      const metrics = cache.getMetrics();
      expect(metrics.expiredHits).toBe(1);
      expect(metrics.evictions).toBe(1);
    });

    it('touches LRU when cache size > 10', () => {
      for (let i = 0; i < 15; i++) {
        cache.set(`key${i}`, [], 0);
      }

      // Get the oldest item, making it the most recently used
      cache.get('key0');

      // Fill cache to capacity (100) to trigger eviction
      for (let i = 15; i <= 101; i++) {
        cache.set(`key${i}`, [], 0);
      }

      // key0 should still be there because it was touched, key1 should be evicted
      expect(cache.get('key0')).not.toBeNull();
      expect(cache.get('key1')).toBeNull();
    });

    it('evicts expired entries first when at capacity', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, [], 0);
      }

      // Expire all current entries
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Set new entry, which should trigger eviction of an expired entry
      cache.set('newKey', [], 0);

      const metrics = cache.getMetrics();
      expect(metrics.expiredHits).toBe(1); // One expired entry was evicted
      expect(metrics.evictions).toBe(1);
      expect(metrics.capacityEvictions).toBe(0);
      expect(cache.getMetrics().size).toBe(100);
    });

    it('evicts LRU entry when at capacity and no expired entries', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, [], 0);
      }

      // Set new entry, which should trigger LRU eviction (key0)
      cache.set('newKey', [], 0);

      const metrics = cache.getMetrics();
      expect(metrics.capacityEvictions).toBe(1);
      expect(metrics.evictions).toBe(1);

      expect(cache.get('key0')).toBeNull();
    });

    it('clears cache and metrics', () => {
      cache.set('key1', [], 0);
      cache.get('key1'); // 1 hit
      cache.get('missing'); // 1 miss

      cache.clear();
      expect(cache.getMetrics().size).toBe(0);

      cache.resetMetrics();
      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
    });
  });

  describe('CriteriaCache', () => {
    let cache: CriteriaCache;

    beforeEach(() => {
      vi.useFakeTimers();
      cache = new CriteriaCache();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('normalizes keys', () => {
      const criteria: any = { type: 'test' };
      cache.set('  HELLO   WORLD  ', criteria);

      expect(cache.get('hello world')).toBe(criteria);
    });

    it('sets and gets entries', () => {
      const criteria: any = { type: 'test' };
      cache.set('key', criteria);

      expect(cache.get('key')).toBe(criteria);

      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(0);
    });

    it('returns null for missing keys', () => {
      expect(cache.get('missing')).toBeNull();

      const metrics = cache.getMetrics();
      expect(metrics.misses).toBe(1);
    });

    it('evicts expired entries on get', () => {
      const criteria: any = { type: 'test' };
      cache.set('key', criteria);

      // Advance time by 31 minutes
      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(cache.get('key')).toBeNull();

      const metrics = cache.getMetrics();
      expect(metrics.expiredHits).toBe(1);
    });

    it('evicts expired entries first when at capacity', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, {} as any);
      }

      // Expire all entries
      vi.advanceTimersByTime(31 * 60 * 1000);

      cache.set('newKey', {} as any);

      expect(cache.getMetrics().size).toBe(100);
      // It evicted an expired entry to make room
    });

    it('evicts LRU entry when at capacity and no expired entries', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, {} as any);
      }

      cache.set('newKey', {} as any);

      expect(cache.getMetrics().size).toBe(100);
      expect(cache.get('key0')).toBeNull(); // First item evicted
    });

    it('resets metrics', () => {
      cache.set('key', {} as any);
      cache.get('key');
      cache.get('missing');

      cache.resetMetrics();
      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
    });
  });
});
