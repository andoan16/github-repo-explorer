import type { GitHubRepo } from '../../shared/types';

interface ValidationResult {
  valid: string[];
  dropped: { suggestion: string; reason: string; kind: 'redundancy' | 'cardinality' }[];
}

/**
 * Pass-2 validator for LLM-generated refinement suggestions.
 *
 * Each candidate suggestion is checked against the actual result set using
 * heuristic keyword extraction. Suggestions that would clearly produce too
 * few results (<2) or are redundant with active filters are dropped.
 */
export class RefinementValidator {
  private static KNOWN_LANGUAGES = new Set([
    'python', 'javascript', 'typescript', 'go', 'rust', 'java', 'kotlin',
    'swift', 'c++', 'c#', 'ruby', 'php', 'scala', 'elixir', 'haskell',
    'clojure', 'dart', 'lua', 'zig', 'nim', 'crystal', 'julia', 'r',
    'perl', 'shell', 'objective-c',
  ]);

  private static KNOWN_LICENSES = new Set([
    'mit', 'apache', 'gpl', 'bsd', 'mpl', 'lgpl', 'agpl', 'unlicense',
    'isc', 'cc0', 'epl',
  ]);

  validate(
    suggestions: string[],
    repos: GitHubRepo[],
    activeFilters: { language?: string | null; license?: string | null; minStars?: number },
  ): ValidationResult {
    const valid: string[] = [];
    const dropped: { suggestion: string; reason: string; kind: 'redundancy' | 'cardinality' }[] = [];

    for (const suggestion of suggestions) {
      const result = this.validateOne(suggestion, repos, activeFilters);
      if (result === null) {
        valid.push(suggestion);
      } else {
        dropped.push({ suggestion, reason: result.reason, kind: result.kind });
      }
    }

    // Safety net: if every suggestion was dropped due to cardinality and none due to
    // redundancy, return all original suggestions — the LLM attempted meaningful
    // suggestions but our heuristics were too aggressive. Redundancy drops are never
    // resurrected (suggesting a filter already active is actively confusing).
    if (valid.length === 0 && suggestions.length > 0) {
      const hasRedundancy = dropped.some((d) => d.kind === 'redundancy');
      if (!hasRedundancy) {
        return { valid: suggestions, dropped: [] };
      }
    }

    return { valid, dropped };
  }

  private validateOne(
    suggestion: string,
    repos: GitHubRepo[],
    filters: { language?: string | null; license?: string | null; minStars?: number },
  ): { reason: string; kind: 'redundancy' | 'cardinality' } | null {
    const lower = suggestion.toLowerCase();

    // ── Redundancy: already-filtered language ──
    const langMatch = this.extractLanguage(lower);
    if (langMatch && filters.language && filters.language.toLowerCase() === langMatch) {
      return { reason: `already filtered to ${filters.language}`, kind: 'redundancy' };
    }

    // ── Redundancy: already-filtered license ──
    const licenseMatch = this.extractLicense(lower);
    if (licenseMatch && filters.license && filters.license.toLowerCase().includes(licenseMatch)) {
      return { reason: `already filtered to ${filters.license}`, kind: 'redundancy' };
    }

    // ── Cardinality check: language ──
    if (langMatch && !filters.language) {
      const count = repos.filter((r) =>
        r.language?.toLowerCase() === langMatch,
      ).length;
      if (count < 2) {
        return { reason: `only ${count} ${langMatch} repo(s) found`, kind: 'cardinality' };
      }
    }

    // ── Cardinality check: license ──
    if (licenseMatch && !filters.license) {
      const count = repos.filter((r) =>
        r.license?.key?.toLowerCase().includes(licenseMatch),
      ).length;
      if (count < 2) {
        return { reason: `only ${count} ${licenseMatch}-licensed repo(s) found`, kind: 'cardinality' };
      }
    }

    // ── Cardinality check: star threshold ──
    const starThreshold = this.extractStarThreshold(lower);
    if (starThreshold && (!filters.minStars || starThreshold > filters.minStars)) {
      const count = repos.filter((r) => r.stars >= starThreshold).length;
      if (count < 2) {
        return { reason: `only ${count} repo(s) above ${starThreshold} stars`, kind: 'cardinality' };
      }
    }

    return null; // valid
  }

  private extractLanguage(text: string): string | null {
    const patterns = [
      /(?:prefer|more|try|use|only|switch to|filter\s+to)\s+(\w+(?:\+\+|#)?)/i,
      /(\w+(?:\+\+|#)?)\s*(?:based|only|alternative|projects)/i,
      /^(?:only\s+)?(\w+(?:\+\+|#)?)$/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const word = match[1].toLowerCase();
        // Map common aliases
        const aliasMap: Record<string, string> = {
          'c++': 'c++',
          'c#': 'c#',
          'ts': 'typescript',
          'js': 'javascript',
          'objc': 'objective-c',
          'objectivec': 'objective-c',
        };
        const canonical = aliasMap[word] ?? word;
        if (RefinementValidator.KNOWN_LANGUAGES.has(canonical)) {
          return canonical;
        }
      }
    }

    return null;
  }

  private extractLicense(text: string): string | null {
    for (const license of RefinementValidator.KNOWN_LICENSES) {
      if (text.includes(license)) return license;
    }
    return null;
  }

  private extractStarThreshold(text: string): number | null {
    const patterns = [
      /(?:above|over|more\s+than|at\s+least|only\s+>\s*)\s*(\d[\d,]*)\s*(?:k|K|stars)?/i,
      /only\s+(\d[\d,]*)\s*(?:k|K|\+)?\s*(?:stars)?/i,
      />\s*(\d[\d,]*)\s*(?:k|K|stars)?/i,
      /(\d[\d,]*)\s*(?:k|K)\+?\s*(?:stars)?/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let num = parseInt(match[1].replace(/,/g, ''), 10);
        // Handle "5k" or "5K" → 5000
        const fullMatch = text.slice(match.index!, match.index! + match[0].length);
        if (/[kK]/.test(fullMatch)) {
          num *= 1000;
        }
        return num;
      }
    }

    return null;
  }
}
