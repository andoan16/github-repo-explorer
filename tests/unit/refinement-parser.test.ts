import { describe, it, expect } from 'vitest';
import { RefinementParser } from '../../src/main/search/refinement-parser';

describe('RefinementParser', () => {
  const parser = new RefinementParser();

  describe('raw-sort stars', () => {
    it('detects "highest star"', () => {
      const r = parser.detect('highest star');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
      expect(r?.sortDesc).toBe(true);
    });

    it('detects "highest stars"', () => {
      const r = parser.detect('highest stars');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
    });

    it('detects "most stars"', () => {
      const r = parser.detect('most stars');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
    });

    it('detects "top stars"', () => {
      const r = parser.detect('top stars');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
    });

    it('detects "sort by stars"', () => {
      const r = parser.detect('sort by stars');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
    });

    it('detects "star sort"', () => {
      const r = parser.detect('star sort');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
    });

    it('detects "popularity sort"', () => {
      const r = parser.detect('popularity sort');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('stars');
    });
  });

  describe('raw-sort activity', () => {
    it('detects "newest"', () => {
      const r = parser.detect('newest');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('updated_at');
    });

    it('detects "most recent"', () => {
      const r = parser.detect('most recent');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('updated_at');
    });

    it('detects "sort by date"', () => {
      const r = parser.detect('sort by date');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('updated_at');
    });

    it('detects "latest updated"', () => {
      const r = parser.detect('latest updated');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('updated_at');
    });
  });

  describe('raw-sort forks', () => {
    it('detects "most forks"', () => {
      const r = parser.detect('most forks');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('forks');
    });

    it('detects "highest forks"', () => {
      const r = parser.detect('highest forks');
      expect(r?.type).toBe('raw-sort');
      expect(r?.sortKey).toBe('forks');
    });
  });

  describe('emphasis star-heavy', () => {
    it('detects "more popular" as star-heavy emphasis', () => {
      const r = parser.detect('more popular');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.starsScore).toBe(3.0);
    });

    it('detects "higher stars" as star-heavy emphasis', () => {
      const r = parser.detect('higher stars');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.starsScore).toBe(3.0);
    });

    it('detects "well known" as star-heavy emphasis', () => {
      const r = parser.detect('well known');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.starsScore).toBe(3.0);
    });
  });

  describe('emphasis recency-heavy', () => {
    it('detects "more active" as recency-heavy emphasis', () => {
      const r = parser.detect('more active');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.activityScore).toBe(3.0);
    });

    it('detects "actively maintained" as recency-heavy emphasis', () => {
      const r = parser.detect('recently maintained');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.activityScore).toBe(3.0);
    });
  });

  describe('language preference (local)', () => {
    it('detects "prefer Go" as language emphasis', () => {
      const r = parser.detect('prefer Go');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.languageMatch).toBe(3.0);
    });

    it('detects "only typescript projects" as language emphasis', () => {
      const r = parser.detect('only typescript projects');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.languageMatch).toBe(3.0);
    });
  });

  describe('license preference (local)', () => {
    it('detects "MIT license" as license emphasis', () => {
      const r = parser.detect('MIT license');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.licenseCompatibility).toBe(3.0);
    });

    it('detects "open source only" as license emphasis', () => {
      const r = parser.detect('open source only');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.licenseCompatibility).toBe(3.0);
    });
  });

  describe('topic adjustment (local)', () => {
    it('detects "more DevOps" as topic boost', () => {
      const r = parser.detect('more DevOps');
      expect(r?.type).toBe('emphasis');
      expect(r?.emphasis?.semanticMatch).toBe(2.0);
    });
  });

  describe('falls through to null (LLM)', () => {
    it('returns null for truly ambiguous input', () => {
      const r = parser.detect('something completely unknown');
      expect(r).toBeNull();
    });
  });

  describe('star threshold filter', () => {
    it('detects "above 10,000 stars" as filter', () => {
      const r = parser.detect('above 10,000 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(10000);
    });

    it('detects "above 500 stars" as filter', () => {
      const r = parser.detect('above 500 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(500);
    });

    it('detects "over 1000 stars" as filter', () => {
      const r = parser.detect('over 1000 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(1000);
    });

    it('detects "more than 5000 stars" as filter', () => {
      const r = parser.detect('more than 5000 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(5000);
    });

    it('detects "at least 500 stars" as filter', () => {
      const r = parser.detect('at least 500 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(500);
    });

    it('detects "10k stars" as filter with k multiplier', () => {
      const r = parser.detect('10k stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(10000);
    });

    it('detects "5K stars" as filter with capital K', () => {
      const r = parser.detect('5K stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(5000);
    });

    it('detects ">5000" as filter', () => {
      const r = parser.detect('>5000');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(5000);
    });

    it('detects "1k+" as filter with bonus suffix', () => {
      const r = parser.detect('1k+');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(1000);
    });

    it('detects "above 10,000 stars" (with commas)', () => {
      const r = parser.detect('above 10,000 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(10000);
    });

    it('detects "above 50000 stars" (large number)', () => {
      const r = parser.detect('above 50000 stars');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(50000);
    });

    it('does NOT match "most popular" as a star threshold (should be emphasis)', () => {
      const r = parser.detect('most popular');
      expect(r?.type).toBe('emphasis');
      expect(r?.minStars).toBeUndefined();
    });

    it('does NOT match "highest stars" as filter (should be raw-sort)', () => {
      const r = parser.detect('highest stars');
      expect(r?.type).toBe('raw-sort');
    });

    it('detects "above 100 stars" as filter even with whitespace', () => {
      const r = parser.detect('  above 100 stars  ');
      expect(r?.type).toBe('filter');
      expect(r?.minStars).toBe(100);
    });
  });
});
