/**
 * Search Precision Optimizer Module
 * Reference implementation based on Goodnight77/rag-skills and search-precision-optimizer skill.
 * Provides code-aware tokenization, exact identifier boosting, and Reciprocal Rank Fusion (RRF).
 */

import type { GitHubRepo } from '../../shared/types';

export interface ParsedCodeTokens {
  exactPhrases: string[];
  identifiers: string[];
  subTokens: string[];
  filePaths: string[];
  scopedPackages: string[];
  allTokens: string[];
}

/**
 * Natural language stop words.
 * CRITICAL: Programming keywords (for, in, class, type, server, manager, tool)
 * are NOT included here to prevent over-pruning technical queries.
 */
export const NATURAL_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'at', 'by', 'from',
  'with', 'for', 'about', 'into', 'through', 'during',
  'tôi', 'muốn', 'cần', 'cho', 'với', 'trong', 'về', 'các', 'những', 'một', 'để'
]);

export class CodeAwareTokenizer {
  /**
   * Split camelCase or PascalCase strings into constituent words.
   * e.g., "pdfCraft" -> ["pdf", "craft"], "PDFViewer" -> ["pdf", "viewer"]
   */
  static splitCamelCase(word: string): string[] {
    return word
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z0-9])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
  }

  /**
   * Parses technical query or repo metadata into enriched token bags.
   */
  static tokenize(inputs: string | string[]): ParsedCodeTokens {
    const rawList = Array.isArray(inputs) ? inputs : [inputs];
    const exactPhrases: string[] = [];
    const identifiers: string[] = [];
    const subTokens: string[] = [];
    const filePaths: string[] = [];
    const scopedPackages: string[] = [];
    const tokenSet = new Set<string>();

    for (const rawInput of rawList) {
      if (!rawInput || !rawInput.trim()) continue;

      let cleanInput = rawInput;

      // 1. Extract exact quoted phrases ("...")
      const phraseRegex = /"([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = phraseRegex.exec(rawInput)) !== null) {
        const phrase = match[1].toLowerCase().trim();
        if (phrase) {
          exactPhrases.push(phrase);
          tokenSet.add(phrase);
        }
      }
      cleanInput = cleanInput.replace(phraseRegex, ' ');

      // 2. Extract scoped packages (e.g., @tanstack/react-query, @nestjs/core)
      const scopedRegex = /@([a-z0-9_-]+)\/([a-z0-9_.-]+)/gi;
      while ((match = scopedRegex.exec(cleanInput)) !== null) {
        const fullScope = match[0].toLowerCase();
        const scopeOrg = match[1].toLowerCase();
        const pkgName = match[2].toLowerCase();
        scopedPackages.push(fullScope);
        tokenSet.add(fullScope);
        tokenSet.add(`${scopeOrg}/${pkgName}`);
        tokenSet.add(scopeOrg);
        tokenSet.add(pkgName);
        identifiers.push(pkgName);
      }
      cleanInput = cleanInput.replace(scopedRegex, ' ');

      // 3. Extract file paths and config file names (e.g., application.yml, docker-compose.yml)
      const fileRegex = /([\w.-]+\.(yml|yaml|json|toml|xml|ts|js|jsx|tsx|py|rs|go|md|sql|sh))/gi;
      while ((match = fileRegex.exec(cleanInput)) !== null) {
        const f = match[0].toLowerCase();
        filePaths.push(f);
        tokenSet.add(f);
        const parts = f.split('.');
        const ext = parts.pop();
        const base = parts.join('.');
        if (base) tokenSet.add(base);
        if (ext) {
          tokenSet.add(`.${ext}`);
          tokenSet.add(ext);
        }
      }

      // 4. Tokenize by technical delimiters while preserving identifier candidates
      const words = cleanInput.split(/[\s,;!()\[\]{}]+/).filter(Boolean);

      for (const raw of words) {
        const lower = raw.toLowerCase().trim();
        if (!lower || lower.length < 2) continue;

        if (NATURAL_STOP_WORDS.has(lower) && !raw.includes('_') && !raw.includes('-') && !raw.includes('.')) {
          continue;
        }

        tokenSet.add(lower);

        // Sub-stemming for common English suffixes
        if (lower.endsWith('s') && lower.length >= 4) tokenSet.add(lower.slice(0, -1));
        if (lower.endsWith('or') && lower.length >= 5) tokenSet.add(lower.slice(0, -2));
        if (lower.endsWith('er') && lower.length >= 5) tokenSet.add(lower.slice(0, -2));

        // Detect snake_case or kebab-case
        if (raw.includes('_') || raw.includes('-')) {
          identifiers.push(raw);
          const parts = raw.split(/[_-]+/).filter((p) => p.length >= 2);
          for (const p of parts) {
            const pLower = p.toLowerCase();
            subTokens.push(pLower);
            tokenSet.add(pLower);
          }
        }

        // Detect camelCase or PascalCase
        if (/[a-z][A-Z]/.test(raw) || /[A-Z]{2,}[a-z]/.test(raw)) {
          identifiers.push(raw);
          const camelParts = CodeAwareTokenizer.splitCamelCase(raw);
          for (const cp of camelParts) {
            subTokens.push(cp);
            tokenSet.add(cp);
          }
        }

        // Detect Dot-notation (e.g., pdf.lib, vue.js, app.config)
        if (raw.includes('.') && !raw.startsWith('.')) {
          const parts = raw.split('.').filter((p) => p.length >= 2);
          for (const p of parts) {
            tokenSet.add(p.toLowerCase());
          }
        }
      }
    }

    return {
      exactPhrases,
      identifiers,
      subTokens,
      filePaths,
      scopedPackages,
      allTokens: Array.from(tokenSet),
    };
  }
}

/**
 * Checks if a token matches within a text using word-boundary logic,
 * eliminating false positive substring hits (e.g. "cat" inside "application").
 */
export function containsWordBoundary(text: string, token: string): boolean {
  if (!text || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-z0-9_-])${escaped}(?:$|[^a-z0-9_-])`, 'i');
  return regex.test(text);
}

/**
 * Precision score booster for exact identifier / repo slug matches.
 * Solves the critical vocabulary-mismatch and popularity-bias trap where a 100k-star
 * generic repo outranks the exact tool the user asked for.
 */
export function computeExactIdentifierBoost(
  repo: GitHubRepo,
  queryOrKeywords: string | string[],
  parsedTokens?: ParsedCodeTokens,
): number {
  let boost = 0;
  const fullNameLower = repo.full_name.toLowerCase();
  const repoName = (repo.full_name.split('/')[1] || repo.full_name).toLowerCase();
  const descLower = (repo.description ?? '').toLowerCase();
  const topics = repo.topics.map((t) => t.toLowerCase());

  const queries = Array.isArray(queryOrKeywords) ? queryOrKeywords : [queryOrKeywords];
  const tokens = parsedTokens ?? CodeAwareTokenizer.tokenize(queries);

  for (const q of queries) {
    const qClean = q.toLowerCase().trim().replace(/[^\w-]/g, '');
    if (qClean.length < 2) continue;

    // 1. Exact repository name match (e.g., query "pdfcraft" matches repo "pdfcraft", "fzf" matches "fzf")
    if (repoName === qClean) {
      boost += 0.40;
    } else if (fullNameLower === qClean || fullNameLower.endsWith(`/${qClean}`)) {
      boost += 0.35;
    } else if (repoName.startsWith(qClean) || repoName.endsWith(qClean)) {
      boost += 0.15;
    }

    // 2. Exact topic match
    if (topics.includes(qClean)) {
      boost += 0.15;
    }
  }

  // 3. Short acronym or single-token exact repo name match (e.g., "fzf", "bat", "jq", "act", "glow", "kysely", "zod")
  for (const tok of tokens.allTokens) {
    if (tok.length >= 2 && repoName === tok) {
      boost += 0.35;
      break;
    }
  }

  // 4. Scoped packages matching (e.g. @tanstack/react-query matches TanStack/query or TanStack/react-query)
  for (const sp of tokens.scopedPackages) {
    const raw = sp.replace(/^@/, '');
    if (fullNameLower === raw || fullNameLower.endsWith(`/${raw.split('/')[1]}`)) {
      boost += 0.35;
    } else if (repoName === raw.split('/')[1] || (raw.split('/')[1].includes(repoName) && repoName.length >= 3)) {
      boost += 0.25;
    }
  }

  // 5. File path exact matching in description
  for (const fp of tokens.filePaths) {
    if (descLower.includes(fp) || fullNameLower.includes(fp.split('.')[0])) {
      boost += 0.20;
    }
  }

  // 6. Exact phrase match in description with word boundary
  for (const phrase of tokens.exactPhrases) {
    if (containsWordBoundary(descLower, phrase)) {
      boost += 0.15;
    }
  }

  // 7. Exact identifier match across identifiers in query
  for (const ident of tokens.identifiers) {
    const identLower = ident.toLowerCase();
    if (repoName === identLower) {
      boost += 0.30;
    } else if (repoName.includes(identLower) || topics.includes(identLower)) {
      boost += 0.10;
    }
  }

  return Math.min(0.55, boost);
}

/**
 * Reciprocal Rank Fusion (RRF) implementation for parameter-free rank aggregation.
 * Reference: RRF_Score(d) = sum(w_m / (k + rank_m(d)))
 */
export interface RankedEntry<T> {
  id: string | number;
  item: T;
  rank: number;
  score?: number;
}

export function reciprocalRankFusion<T>(
  rankings: Array<{ list: RankedEntry<T>[]; weight?: number }>,
  k = 60,
): Array<{ id: string | number; item: T; rrfScore: number }> {
  const scoreMap = new Map<string | number, { item: T; rrfScore: number }>();

  for (const { list, weight = 1.0 } of rankings) {
    for (const entry of list) {
      const contribution = weight / (k + entry.rank);
      const existing = scoreMap.get(entry.id);
      if (existing) {
        existing.rrfScore += contribution;
      } else {
        scoreMap.set(entry.id, { item: entry.item, rrfScore: contribution });
      }
    }
  }

  return Array.from(scoreMap.entries())
    .map(([id, val]) => ({ id, item: val.item, rrfScore: val.rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}
