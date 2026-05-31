import type { WeightEmphasis } from '../../shared/types';
import { detectVietnamese, detectVietnameseRefinement } from './vietnamese';

/**
 * Detects deterministic refinement patterns and converts them to weight-emphasis
 * or signals that the caller should bypass the LLM and sort directly.
 */
export interface DetectedRefinement {
  type: 'emphasis' | 'raw-sort';
  emphasis?: WeightEmphasis;
  sortKey?: 'stars' | 'updated_at' | 'forks';
  sortDesc?: boolean;
}

const KNOWN_LANGUAGES = new Set([
  'python', 'javascript', 'typescript', 'go', 'golang', 'rust', 'java', 'kotlin',
  'swift', 'ruby', 'php', 'scala', 'elixir', 'haskell', 'clojure', 'dart',
  'lua', 'zig', 'nim', 'crystal', 'c++', 'c#', 'r', 'perl', 'shell', 'bash',
  'objective-c', 'julia',
]);

const OPEN_SOURCE_LICENSES = new Set([
  'mit', 'apache', 'apache-2.0', 'gpl', 'gpl-2.0', 'gpl-3.0',
  'bsd', 'bsd-2', 'bsd-3', 'mpl', 'mpl-2.0', 'lgpl', 'agpl',
  'unlicense', 'isc', 'cc0', 'epl',
]);

export class RefinementParser {
  detect(refinementText: string): DetectedRefinement | null {
    const lower = refinementText.toLowerCase().trim();

    // ── Vietnamese refinement patterns (check first for Vietnamese input) ──
    if (detectVietnamese(refinementText) >= 0.3) {
      const viRefinement = detectVietnameseRefinement(refinementText);
      if (viRefinement) return viRefinement;
      // If Vietnamese was detected but no local pattern matched, fall through
      // to LLM for translation-based handling
    }

    // ── Star-based sorting ──
    if (this.isStarsSort(lower)) {
      return { type: 'raw-sort', sortKey: 'stars', sortDesc: true };
    }

    // ── Activity/recency sorting ──
    if (this.isActivitySort(lower)) {
      return { type: 'raw-sort', sortKey: 'updated_at', sortDesc: true };
    }

    // ── Forks sorting ──
    if (this.isForksSort(lower)) {
      return { type: 'raw-sort', sortKey: 'forks', sortDesc: true };
    }

    // ── Language preference — "prefer Go", "python only", "more Rust" ──
    const langMatch = this.detectLanguagePreference(lower);
    if (langMatch) return langMatch;

    // ── License preference — "MIT license", "open source only" ──
    const licenseMatch = this.detectLicensePreference(lower);
    if (licenseMatch) return licenseMatch;

    // ── Heavy star emphasis (but not pure-sort) — before topicAdjustment so
    //     "more popular" still maps to star-heavy, not generic topic boost.
    if (this.isStarHeavy(lower)) {
      return {
        type: 'emphasis',
        emphasis: {
          semanticMatch: 1.0,
          starsScore: 3.0,
          activityScore: 0.5,
          readmeRelevance: 0.5,
          languageMatch: 0.5,
          licenseCompatibility: 0.5,
        },
      };
    }

    // ── Heavy recency emphasis
    if (this.isRecencyHeavy(lower)) {
      return {
        type: 'emphasis',
        emphasis: {
          semanticMatch: 1.0,
          starsScore: 0.5,
          activityScore: 3.0,
          readmeRelevance: 0.5,
          languageMatch: 0.5,
          licenseCompatibility: 0.5,
        },
      };
    }

    // ── Topic/domain adjustment — "more DevOps", "less frontend", "less Kubernetes" ──
    const topicMatch = this.detectTopicAdjustment(lower);
    if (topicMatch) return topicMatch;

    return null; // fall through to LLM
  }

  private detectLanguagePreference(text: string): DetectedRefinement | null {
    const patterns = [
      /(?:prefer|more|use|only|switch\s+to|filter\s+to)\s+(\w+(?:\+\+|#)?)\b/i,
      /^(\w+(?:\+\+|#)?)\s+(?:only|projects|repos)$/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const word = match[1].toLowerCase();
        const aliasMap: Record<string, string> = {
          'c++': 'c++', 'c#': 'c#',
          'ts': 'typescript', 'js': 'javascript',
          'objc': 'objective-c', 'objectivec': 'objective-c',
          'golang': 'go',
        };
        const lang = aliasMap[word] ?? word;
        if (KNOWN_LANGUAGES.has(lang)) {
          return {
            type: 'emphasis',
            emphasis: {
              semanticMatch: 1.5,  // boost relevance
              starsScore: 1.0,
              activityScore: 1.0,
              readmeRelevance: 1.0,
              languageMatch: 3.0,   // heavily boost language
              licenseCompatibility: 1.0,
            },
          };
        }
      }
    }
    return null;
  }

  private detectLicensePreference(text: string): DetectedRefinement | null {
    // "open source only" / "permissive license" / "Apache-licensed"
    const openSourcePatterns = [
      /(?:open.source|oss)\s*(?:only|projects|license)/i,
      /(?:permissive|free)\s+(?:license|software)/i,
      /only\s+(?:open.source|oss|permissive|free)/i,
    ];
    for (const p of openSourcePatterns) {
      if (p.test(text)) {
        return {
          type: 'emphasis',
          emphasis: {
            semanticMatch: 1.0,
            starsScore: 1.0,
            activityScore: 1.0,
            readmeRelevance: 1.0,
            languageMatch: 1.0,
            licenseCompatibility: 3.0,
          },
        };
      }
    }

    // Specific license: "MIT license", "Apache-licensed", etc.
    for (const lic of OPEN_SOURCE_LICENSES) {
      if (text.includes(lic) && /(?:license|licensed|only)/i.test(text)) {
        return {
          type: 'emphasis',
          emphasis: {
            semanticMatch: 1.0,
            starsScore: 1.0,
            activityScore: 1.0,
            readmeRelevance: 1.0,
            languageMatch: 1.0,
            licenseCompatibility: 3.0,
          },
        };
      }
    }

    return null;
  }

  private detectTopicAdjustment(text: string): DetectedRefinement | null {
    // "more X" or "less X" adjustments — boost or dampen semantic match
    const moreMatch = text.match(/more\s+(\w+(?:\s+\w+)?)/i);
    if (moreMatch) {
      return {
        type: 'emphasis',
        emphasis: {
          semanticMatch: 2.0,  // boost relevance matching for the topic
          starsScore: 1.0,
          activityScore: 1.0,
          readmeRelevance: 1.5, // README becomes more important
          languageMatch: 1.0,
          licenseCompatibility: 1.0,
        },
      };
    }

    const lessMatch = text.match(/less\s+(\w+(?:\s+\w+)?)/i);
    if (lessMatch) {
      // Dampen: the user wants less of something, boost stars and license instead
      return {
        type: 'emphasis',
        emphasis: {
          semanticMatch: 0.5,   // reduce semantic relevance
          starsScore: 1.5,       // surface different repos
          activityScore: 1.5,
          readmeRelevance: 1.0,
          languageMatch: 1.5,
          licenseCompatibility: 1.0,
        },
      };
    }

    return null;
  }

  private isStarsSort(text: string): boolean {
    const patterns = [
      /^(?:highest|most|top)\s+stars?$/,
      /^stars?\s+(?:highest|most|top)$/,
      /^sort\s+by\s+stars?$/,
      /^(?:by|per)\s+stars?$/,
      /^most\s+stars?$/,
      /^show\s+me\s+(?:the\s+)?(?:highest|most|top)\s+stars?$/,
      /^sort\s+(?:by\s+)?(?:star\s+)?(?:count|popularity)$/,
      /^(?:star|popularity)\s+(?:sort|rank)$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private isActivitySort(text: string): boolean {
    const patterns = [
      /^(?:newest|latest|most\s+recent)$/,
      /^sort\s+by\s+(?:date|updated|recently|activity|newest|latest)$/,
      /^(?:recently|latest)\s+(?:updated|active)$/,
      /^by\s+(?:date|activity|update\s+date)$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private isForksSort(text: string): boolean {
    const patterns = [
      /^(?:most|highest|top)\s+forks?$/,
      /^sort\s+by\s+forks?$/,
      /^by\s+forks?$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private isStarHeavy(text: string): boolean {
    const patterns = [
      /\b(?:popular|famous|well.known|widely.used|mature)\b/,
      /\bmore\s+(?:popular|established|proven)\b/,
      /(?:higher|more|bigger)\s+stars?/,
      /\bstars?\s+(?:matter|important|heavy)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private isRecencyHeavy(text: string): boolean {
    const patterns = [
      /^(?:more|very)\s+(?:recent|active|alive|fresh)$/,
      /\b(?:actively|frequently|recently|freshly)\b.*(?:updated|maintained)/,
      /(?:updated|maintained)\b.*\b(?:recently|actively|often)/,
    ];
    return patterns.some((p) => p.test(text));
  }
}
