import type { SearchCriteria, SearchParams, WeightEmphasis } from '../../shared/types';
import type { OllamaClient } from '../ollama/client';
import type { GitHubRepo } from '../../shared/types';
import { computeResultStatistics, mineNegativeSpace } from './result-stats';
import { detectVietnamese } from './vietnamese';  // kept for default fallback when precomputedIsVietnamese is not provided

const INTENT_ANGLES: Record<string, string> = {
  'web-app': 'Prioritize suggestions about framework choice, hosting model, frontend vs full-stack, and deployment complexity.',
  'cli-tool': 'Prioritize suggestions about cross-platform support, installation method, shell integration, and configuration format.',
  'library': 'Prioritize suggestions about API surface, TypeScript types, bundle size, framework compatibility, and language bindings.',
  'api': 'Prioritize suggestions about REST vs GraphQL, authentication model, rate limiting, and SDK availability.',
  'mobile-app': 'Prioritize suggestions about cross-platform vs native, iOS/Android coverage, and offline support.',
  'desktop-app': 'Prioritize suggestions about cross-platform support, native vs Electron, and installer packaging.',
  'devops-tool': 'Prioritize suggestions about self-hosted vs SaaS, Docker/Kubernetes support, configuration format, and infrastructure compatibility.',
  'ai-ml-tool': 'Prioritize suggestions about model format, training vs inference, hardware requirements, and framework integration.',
  'database': 'Prioritize suggestions about storage model, scalability, query language, and cloud vs embedded.',
  'networking-tool': 'Prioritize suggestions about protocol support, throughput, security features, and agent vs agentless.',
  'security-tool': 'Prioritize suggestions about attack surface, compliance standards, integration model, and automation capability.',
};

export class QueryGenerator {
  constructor(private ollama: OllamaClient, private model: string) {}

  async extractCriteria(userDescription: string, signal?: AbortSignal, precomputedIsVietnamese?: boolean): Promise<SearchCriteria> {
    // Use pre-computed flag if available to avoid redundant detectVietnamese() call
    const isVietnamese = precomputedIsVietnamese ?? (detectVietnamese(userDescription) >= 0.3);

    const multilingualInstruction = isVietnamese
      ? `\n\nVietnamese input. Translate to English for searchQueries. Map: giám sát→monitoring, máy chủ→server, quản lý mật khẩu→password manager, tự host→self-hosted, mã nguồn mở→open source, giấy phép→license. Include englishTranslation + technicalConcepts fields.`
      : '';

    const prompt = `You are a GitHub search expert. Convert this user request into search criteria for the GitHub API.${multilingualInstruction}

User request: "${userDescription}"

Generate 3 alternative GitHub keyword queries (each 2-4 words), approaching the request from different angles (synonyms, broader/narrower scope, different technology emphasis).${isVietnamese ? ' At least one query should use purely English technical terms translated from the Vietnamese input.' : ''}

Return ONLY valid JSON — no markdown, no code fences, no commentary:

{
  "searchQueries": ["2-4 keywords query 1", "2-4 keywords query 2", "2-4 keywords query 3"],
  "technologies": ["languages or frameworks mentioned or implied"],
  "intent": "web-app | cli-tool | library | api | mobile-app | desktop-app | devops-tool | ai-ml-tool | database | networking-tool | security-tool | other",
  "minStars": number (0-5000, default 0),
  "preferredLicense": "mit" | "apache-2.0" | "gpl-3.0" | "bsd-3-clause" | "mpl-2.0" | null,
  "requireRecentActivity": boolean${isVietnamese ? ',\n  "englishTranslation": "English translation of the user\'s request",\n  "technicalConcepts": ["extracted technical concepts in English, e.g., ci-cd, monitoring, password-manager, self-hosted"]' : ''}
}

JSON:`;

    const raw = await this.ollama.generate(prompt, this.model, signal, 512);
    const criteria = this.parseJson<{
      searchQueries?: string[];
      searchQuery?: string;
      keywords?: string[];
      technologies?: string[];
      intent?: string;
      minStars?: number;
      preferredLicense?: string | null;
      requireRecentActivity?: boolean;
      englishTranslation?: string;
      technicalConcepts?: string[];
    }>(raw);

    // Build keywords from searchQueries array (new format), fall back to legacy searchQuery/keywords
    let queries: string[];
    if (criteria.searchQueries && criteria.searchQueries.length > 0) {
      queries = criteria.searchQueries.filter((q) => q.trim().length > 0);
    } else if (criteria.searchQuery) {
      queries = [criteria.searchQuery];
    } else if (criteria.keywords && criteria.keywords.length > 0) {
      queries = [criteria.keywords.slice(0, 3).join(' ')];
    } else {
      queries = [userDescription];
    }

    // Don't pad with garbage — 1-2 good queries beat 3 where 2 are word-slice
    // nonsense that wastes GitHub API calls on irrelevant results
    queries = queries.slice(0, 3);

    // Extract multilingual fields
    const englishTranslation = criteria.englishTranslation ?? undefined;
    const technicalConcepts = criteria.technicalConcepts ?? [];
    const expandedKeywords: string[] = [];

    // If Vietnamese was detected, build expanded keywords from translation + concepts
    if (isVietnamese && englishTranslation) {
      expandedKeywords.push(englishTranslation);
    }
    if (technicalConcepts.length > 0) {
      expandedKeywords.push(...technicalConcepts.slice(0, 5));
    }

    return {
      keywords: queries.slice(0, 3),
      technologies: criteria.technologies ?? [],
      intent: criteria.intent ?? 'other',
      useCase: userDescription,
      minStars: typeof criteria.minStars === 'number' ? criteria.minStars : 0,
      preferredLicense: criteria.preferredLicense ?? null,
      requireRecentActivity: criteria.requireRecentActivity ?? false,
      ...(isVietnamese ? {
        expandedKeywords: expandedKeywords.length > 0 ? expandedKeywords : undefined,
        originalQuery: userDescription,
        englishTranslation: englishTranslation,
        technicalConcepts: technicalConcepts.length > 0 ? technicalConcepts : undefined,
      } : {}),
    };
  }

  buildSearchParams(criteria: SearchCriteria, filters?: { language?: string | null; license?: string | null; minStars?: number }): SearchParams {
    const query = criteria.keywords.join(' ');
    return {
      query,
      language: filters?.language ?? undefined,
      minStars: filters?.minStars ?? criteria.minStars,
      license: filters?.license ?? criteria.preferredLicense ?? undefined,
      sort: 'stars',
      order: 'desc',
      perPage: 10,
    };
  }

  buildSearchParamsArray(criteria: SearchCriteria, filters?: { language?: string | null; license?: string | null; minStars?: number }): SearchParams[] {
    const baseParams = criteria.keywords.map((keyword) => ({
      query: keyword,
      language: filters?.language ?? undefined,
      minStars: filters?.minStars ?? criteria.minStars,
      license: filters?.license ?? criteria.preferredLicense ?? undefined,
      sort: 'stars' as const,
      order: 'desc' as const,
      perPage: 10,
    }));

    // Add expanded keyword variants (from multilingual translation)
    // These are additional search queries for broader coverage
    if (criteria.expandedKeywords && criteria.expandedKeywords.length > 0) {
      for (const expanded of criteria.expandedKeywords) {
        // Only add if not too similar to existing queries
        const normalizedExpanded = expanded.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const isDuplicate = baseParams.some((p) => {
          const normalizedExisting = p.query.toLowerCase().replace(/[^\w\s]/g, '').trim();
          return normalizedExisting === normalizedExpanded ||
            levenshteinSimilarity(normalizedExisting, normalizedExpanded) > 0.7;
        });
        if (!isDuplicate) {
          baseParams.push({
            query: expanded,
            language: filters?.language ?? undefined,
            minStars: filters?.minStars ?? criteria.minStars,
            license: filters?.license ?? criteria.preferredLicense ?? undefined,
            sort: 'stars' as const,
            order: 'desc' as const,
            perPage: 10,
          });
        }
      }
    }

    return baseParams;
  }

  async generateRefinementSuggestions(
    userRequest: string,
    keywords: string[],
    technologies: string[],
    intent: string,
    resultCount: number,
    repos: GitHubRepo[],
    scorePercentiles?: { top: number; median: number; bottom: number; above80: number; below50: number; total: number },
    feedbackContext?: { narrowCount: number; broadCount: number },
    signal?: AbortSignal,
  ): Promise<string[]> {
    const stats = computeResultStatistics(repos);
    const negSpace = mineNegativeSpace(userRequest, repos, 10);

    // ── Top results block ──
    const topRepos = [...repos]
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 5);
    let topResultsBlock = '';
    if (topRepos.length > 0) {
      topResultsBlock = `─── TOP RESULTS BY STARS ───
${topRepos.map((r, i) => `${i + 1}. ${r.full_name} (★${r.stars.toLocaleString()}) — ${r.description ?? 'No description'}`).join('\n')}
───────────────────────────`;
    }

    // Score-aware context only when available
    let scoreBlock = '';
    let heterogeneityDirective = '';
    if (scorePercentiles && scorePercentiles.total > 0) {
      scoreBlock = `─── SCORE DISTRIBUTION ───
    Top: ${scorePercentiles.top}%, Median: ${scorePercentiles.median}%, Bottom: ${scorePercentiles.bottom}% (${scorePercentiles.total} repos)
    ───────────────────────────`;

      const allLow = scorePercentiles.top < 55;
      const allHigh = scorePercentiles.bottom >= 75 && scorePercentiles.above80 >= scorePercentiles.total * 0.7;
      if (allLow) heterogeneityDirective = 'CRITICAL: Poor match. Suggest broader alternatives. Do NOT narrow.';
      else if (allHigh) heterogeneityDirective = 'Strong matches. Suggest lateral exploration.';
    }

    // ── Cardinality-gated directive (with feedback loop) ──
    let directionHint = '';
    if (resultCount < 5) {
      directionHint = 'IMPORTANT: Only 5 or fewer results found. DO NOT suggest narrowing filters (language, license, or star threshold). Only suggest lateral exploration or broader searches.';
    } else if (resultCount > 30) {
      directionHint = 'IMPORTANT: 30+ results found. Prioritize narrowing suggestions: language, license, star threshold, recency.';
    }

    // Feedback loop: if user has been narrowing repeatedly, bias further narrowing
    if (feedbackContext) {
      if (feedbackContext.narrowCount >= 2 && feedbackContext.narrowCount > feedbackContext.broadCount) {
        directionHint += ' USER PATTERN: User has narrowed several times and keeps going — they want precision. Prioritize even more specific narrowing suggestions.';
      } else if (feedbackContext.broadCount >= 2 && feedbackContext.broadCount > feedbackContext.narrowCount) {
        directionHint += ' USER PATTERN: User keeps broadening — they want discovery. Prioritize lateral exploration and broader suggestions.';
      }
    }

    // ── Negative-space warning ──
    let negSpaceBlock = '';
    if (negSpace.gaps.length > 0) {
      negSpaceBlock = `Missing from results: ${negSpace.gaps.slice(0, 5).join(', ')}. Suggest broader terms for these gaps.`;
    }

    const prompt = `You are a GitHub search expert. A user searched GitHub and received ${resultCount} results. Suggest 3-6 natural-language refinement phrases they could use to narrow or refocus their results.

Original search: "${userRequest}"
Keywords used: ${keywords.join(', ')}
Technologies: ${technologies.join(', ')}
Intent: ${intent}
${INTENT_ANGLES[intent] ? `Intent guidance: ${INTENT_ANGLES[intent]}` : ''}

─── RESULT SET STATISTICS ───
Language distribution: ${stats.languageDistribution}
License distribution: ${stats.licenseDistribution}
Star distribution: ${stats.starRange}
Top topics: ${stats.topTopics}
─────────────────────────────

${topResultsBlock}

${scoreBlock}

${negSpaceBlock}

${heterogeneityDirective}

${directionHint}

Each suggestion should be a short phrase like "only ${stats.languageDistribution.split(',')[0]?.split(' ')[0] ?? 'Go'} projects" or "only MIT-licensed" or "remove unlicensed repos" or "filter to active projects (recently updated)". Make them diverse — different angles (license, language, scope, complexity, use-case). Reference the statistics above when possible so every suggestion is grounded in real data.

Return ONLY valid JSON — no markdown, no code fences, no commentary:
["suggestion 1", "suggestion 2", "suggestion 3"]

JSON:`;

    const raw = await this.ollama.generate(prompt, this.model, signal, 512);
    try {
      const suggestions = this.parseJson<string[]>(raw);
      return Array.isArray(suggestions) ? suggestions.slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  async generateMatchExplanation(repoName: string, repoDescription: string | null, userRequest: string): Promise<string> {
    const prompt = `A user searched for repositories and received this result. Explain in 1-2 sentences why this repository matches the user's request. Be specific and concise.

User request: "${userRequest}"

Repository: ${repoName}
Description: ${repoDescription ?? 'No description available'}

Explanation:`;

    const raw = await this.ollama.generate(prompt, this.model, undefined, 1024);
    return raw.trim();
  }

  async refineCriteria(
    originalCriteria: SearchCriteria,
    refinementText: string,
    originalRequest: string,
    signal?: AbortSignal,
  ): Promise<SearchCriteria> {
    const prompt = `You are a GitHub search expert. A user searched for repositories and wants to refine the results.

Original request: "${originalRequest}"

Original search criteria:
- Keywords: ${originalCriteria.keywords.join(', ')}
- Technologies: ${originalCriteria.technologies.join(', ')}
- Intent: ${originalCriteria.intent}
- Min stars: ${originalCriteria.minStars}
- Preferred license: ${originalCriteria.preferredLicense ?? 'none'}

Refinement instruction from user: "${refinementText}"

Analyze the refinement and adjust the search criteria. You can:
- Adjust emphasis weights (e.g., "more DevOps focused" increases semanticMatch weight, "less enterprise, prefer Go" boosts languageMatch)
- Add or remove technologies
- Narrow or broaden the intent

Return ONLY valid JSON — no markdown, no code fences, no commentary:

{
  "keywords": ["adjusted keywords"],
  "technologies": ["adjusted technology list"],
  "intent": "web-app | cli-tool | library | api | mobile-app | desktop-app | devops-tool | ai-ml-tool | database | networking-tool | security-tool | other",
  "minStars": number,
  "preferredLicense": "mit" | "apache-2.0" | "gpl-3.0" | "bsd-3-clause" | "mpl-2.0" | null,
  "requireRecentActivity": boolean,
  "weightEmphasis": {
    "semanticMatch": number (0.5-2.0, default 1.0),
    "starsScore": number (0.5-2.0, default 1.0),
    "activityScore": number (0.5-2.0, default 1.0),
    "readmeRelevance": number (0.5-2.0, default 1.0),
    "languageMatch": number (0.5-2.0, default 1.0),
    "licenseCompatibility": number (0.5-2.0, default 1.0)
  }
}

JSON:`;

    const raw = await this.ollama.generate(prompt, this.model, signal, 512);
    const parsed = this.parseJson<{
      keywords?: string[];
      technologies?: string[];
      intent?: string;
      minStars?: number;
      preferredLicense?: string | null;
      requireRecentActivity?: boolean;
      weightEmphasis?: WeightEmphasis;
    }>(raw);

    return {
      keywords: parsed.keywords ?? originalCriteria.keywords,
      technologies: parsed.technologies ?? originalCriteria.technologies,
      intent: parsed.intent ?? originalCriteria.intent,
      useCase: originalRequest,
      minStars: typeof parsed.minStars === 'number' ? parsed.minStars : originalCriteria.minStars,
      preferredLicense: parsed.preferredLicense !== undefined ? parsed.preferredLicense : originalCriteria.preferredLicense,
      requireRecentActivity: parsed.requireRecentActivity ?? originalCriteria.requireRecentActivity,
      weightEmphasis: parsed.weightEmphasis,
    };
  }

  async summarizeReadme(readme: string, model: string): Promise<string> {
    const content = readme.length > 4000 ? readme.slice(0, 4000) : readme;
    const prompt = `Summarize the following README in 2-3 sentences, focusing on what the project does and its key features:\n\n${content}\n\nSummary:`;
    return this.ollama.generate(prompt, model, undefined, 1024);
  }

  private parseJson<T>(raw: string): T {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```(?:json)?\s*/g, '').trim();
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]) as T;
      }
      throw new Error(`Failed to parse LLM output as JSON. Raw: ${raw.slice(0, 200)}`);
    }
  }
}

/**
 * Computes a similarity ratio (0-1) between two strings using
 * a 2-row Levenshtein distance — O(min(n,m)) space instead of O(n*m).
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Use the shorter string as the column dimension for less memory
  if (a.length < b.length) {
    [a, b] = [b, a];
  }

  let prevRow = new Array(b.length + 1);
  let currRow = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prevRow[j] = j;

  for (let i = 1; i <= a.length; i++) {
    currRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = b[j - 1] === a[i - 1] ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1,
        prevRow[j] + 1,
        prevRow[j - 1] + cost,
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - prevRow[b.length] / maxLen;
}
