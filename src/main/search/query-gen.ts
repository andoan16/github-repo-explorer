import type { SearchCriteria, SearchParams, WeightEmphasis } from '../../shared/types';
import type { OllamaClient } from '../ollama/client';
import type { GitHubRepo } from '../../shared/types';
import { computeResultStatistics, mineNegativeSpace } from './result-stats';
import { detectVietnamese, extractTechTerms, expandGithubSynonyms, classifyVietnameseIntent, normalizeDiacritics, quickVietnameseTranslateStructured, normalizeVietnameseQuery, ENGLISH_GENERIC_TERMS, VIETNAMESE_STOP_WORDS } from './vietnamese';

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
  'password-manager': 'Prioritize suggestions about encryption at rest, browser extension, sync model, and multi-device support.',
  'self-hosted': 'Prioritize suggestions about deployment method, Docker support, resource requirements, and data ownership.',
  'authentication': 'Prioritize suggestions about protocol support (OAuth2/OIDC/SAML), MFA, session management, and integration with existing identity providers.',
  'messaging': 'Prioritize suggestions about protocol support (Matrix/XMPP/IRC), encryption, federation, and bridging capabilities.',
  'monitoring': 'Prioritize suggestions about data collection method, alerting support, dashboarding, and integration ecosystem.',
  'containerization': 'Prioritize suggestions about container runtime, orchestration support, image management, and resource isolation.',
  'testing': 'Prioritize suggestions about test framework support, CI integration, coverage reporting, and language bindings.',
  'automation': 'Prioritize suggestions about trigger types, workflow complexity, error handling, and integration count.',
  'web-framework': 'Prioritize suggestions about rendering model (SSR/SSG/SPA), bundle size, plugin ecosystem, and TypeScript support.',
  'data-visualization': 'Prioritize suggestions about chart types, rendering performance, interactivity, accessibility, and framework integrations.',
  'retail-pos': 'Prioritize suggestions about POS vs ecommerce vs inventory focus, payment integration, multi-store support, and language/framework.',
};

/**
 * Generic English nouns that are NOT in ENGLISH_GENERIC_TERMS but still match
 * too many GitHub repos to be useful as standalone search queries.
 * When an expandedKeyword is a single word in this set, skip it as a GitHub query.
 * Multi-word expanded keywords containing these words (e.g., "canteen management")
 * are still used because the domain word narrows the result set.
 */
const EXPANDED_KEYWORD_STOPWORDS = new Set([
  'management', 'manager', 'admin', 'monitoring', 'logging',
  'tracking', 'automation', 'security', 'networking', 'database',
  'server', 'client', 'proxy', 'gateway', 'storage', 'cache',
  'search', 'analytics', 'dashboard', 'config', 'deployment',
  'testing', 'build', 'ci', 'cd', 'runner', 'engine', 'runtime',
  'editor', 'viewer', 'parser', 'scheduler', 'worker', 'agent',
  'controller', 'handler', 'provider', 'adapter', 'wrapper',
  'connector', 'bridge', 'sync', 'backup', 'restore', 'recovery',
  'migration', 'import', 'export', 'converter', 'generator',
  'validator', 'checker', 'scanner', 'monitor', 'logger',
  'notifier', 'reporter', 'counter', 'tracker', 'scheduler',
  'cli', 'tui', 'gui', 'api', 'sdk', 'lib', 'app', 'web',
  // Domain-specific but too common as single-word GitHub queries
  'pos', 'retail', 'inventory', 'sales', 'store', 'shop', 'order',
  'payment', 'billing', 'invoice', 'customer', 'crm', 'warehouse',
  'ecommerce', 'restaurant', 'cafe', 'menu', 'delivery', 'checkout',
  'canteen', 'cafeteria', 'food-service',
]);

export class QueryGenerator {
  constructor(private ollama: OllamaClient, private model: string) {}

  async extractCriteria(userDescription: string, signal?: AbortSignal, precomputedIsVietnamese?: boolean): Promise<SearchCriteria> {
    // Use pre-computed flag if available to avoid redundant detectVietnamese() call
    const isVietnamese = precomputedIsVietnamese ?? (detectVietnamese(userDescription) >= 0.3);

    // ── Normalize Vietnamese queries before processing ──
    // Strip polite filler phrases so the LLM prompt and dictionary translation
    // receive clean domain terms instead of sentence-level noise.
    // "tôi muốn tìm một công cụ giám sát" → "công cụ giám sát"
    const effectiveDescription = isVietnamese
      ? normalizeVietnameseQuery(userDescription)
      : userDescription;

    // ── Pre-compute Vietnamese translation for fallback only ──
    // The dictionary translation is used ONLY as a fallback when the LLM is
    // unavailable, and as a light hint. It is NOT injected into the LLM prompt
    // to constrain its reasoning — the LLM should freely analyze the user's
    // actual intent and choose the best GitHub search keywords, even if that
    // means translating "quản lý căn tin" to "point-of-sale inventory" rather
    // than the literal "canteen management".
    const preTrans = isVietnamese ? quickVietnameseTranslateStructured(effectiveDescription) : null;

    // Build a light context block with the original Vietnamese text and
    // dictionary hints. The LLM may use these as a starting point but is
    // explicitly instructed to reason about the user's actual need and choose
    // the best English search keywords — not to copy the dictionary translation.
    // Also pass dictionary concepts as hints so the LLM can broaden beyond
    // literal translation when the domain has a well-known GitHub ecosystem
    // (e.g., "canteen management" → POS, inventory, food-ordering).
    const preContext = isVietnamese
      ? `\n\nThe user wrote in Vietnamese. Translate and reason about their actual intent.\nOriginal Vietnamese: "${userDescription}"${preTrans?.dictionaryConcepts?.length ? `\nDictionary hints (reference only — improve or replace as needed): ${preTrans.dictionaryConcepts.slice(0, 6).join(', ')}` : ''}\n\nIMPORTANT: Do NOT just translate word-by-word. Reason about what kind of GitHub repository the user actually needs, AND include the specific domain term in at least one query. For example, "quản lý căn tin" (canteen management) needs a point-of-sale / inventory / sales system — include "canteen" or "food service" in at least one query alongside broader terms like "point-of-sale" and "inventory". This ensures the search finds repos directly about the user's domain, not just generic POS/inventory systems.\n\nInclude englishTranslation + technicalConcepts fields. The englishTranslation should be a clean domain phrase (no filler like "I want" or "I need").`
      : '';

    const prompt = `You are a GitHub search expert. Convert this user request into search criteria for the GitHub API.${preContext}

User request: "${userDescription}"

Generate 3 alternative GitHub keyword queries (each 2-4 words), approaching the request from different angles (synonyms, broader/narrower scope, different technology emphasis). Think about what TYPE of software project on GitHub would satisfy the user's need, and choose keywords that would find those projects.${isVietnamese ? ' At least one query should use purely English technical terms.' : ''}

Return ONLY valid JSON — no markdown, no code fences, no commentary:

{
  "searchQueries": ["2-4 keywords query 1", "2-4 keywords query 2", "2-4 keywords query 3"],
  "technologies": ["languages or frameworks mentioned or implied"],
  "intent": "web-app | cli-tool | library | api | mobile-app | desktop-app | devops-tool | ai-ml-tool | database | networking-tool | security-tool | retail-pos | other",
  "minStars": number (0-5000, default 0),
  "preferredLicense": "mit" | "apache-2.0" | "gpl-3.0" | "bsd-3-clause" | "mpl-2.0" | null,
  "requireRecentActivity": boolean${isVietnamese ? ',\n  "englishTranslation": "English translation of the user\'s request",\n  "technicalConcepts": ["extracted technical concepts in English, e.g., ci-cd, monitoring, password-manager, self-hosted, point-of-sale, inventory"]' : ''}
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

    // If Vietnamese was detected, build expanded keywords from translation + concepts.
    // Strip filler phrases from englishTranslation before using it as a search query.
    // The LLM sometimes includes "I want a..." or "I need a..." in the translation,
    // which pollutes GitHub search queries with stop words that GitHub requires to match.
    if (isVietnamese && englishTranslation) {
      const cleanTranslation = englishTranslation
        .replace(/^(i\s+want|i\s+need|i\s+would\s+like|i'm\s+looking\s+for|please\s+give\s+me|show\s+me|find\s+me)\s+/i, '')
        .replace(/^(a|an|the)\s+/i, '')
        .trim();
      if (cleanTranslation.length >= 2) {
        expandedKeywords.push(cleanTranslation);
      } else {
        expandedKeywords.push(englishTranslation);
      }
    }
    if (technicalConcepts.length > 0) {
      expandedKeywords.push(...technicalConcepts.slice(0, 5));
    }

    // ── Local Vietnamese fallback enrichment (no LLM call) ──
    // Only merge dictionary concepts/synonyms when the LLM did NOT produce
    // its own. When the LLM reasons and produces good keywords/concepts, we
    // trust its judgment — the dictionary may have a narrower translation
    // (e.g., "canteen-management") that would override the LLM's broader,
    // more accurate understanding (e.g., "point-of-sale inventory sales").
    if (isVietnamese) {
      // Tech terms: these are literal tech names (docker, kubernetes) — always
      // merge because they're factual extractions, not subjective translations.
      const localTechTerms = preTrans?.techTerms ?? extractTechTerms(effectiveDescription);
      for (const t of localTechTerms) {
        if (!technicalConcepts.includes(t)) technicalConcepts.push(t);
      }

      // Dictionary concepts: ONLY use as fallback when LLM produced none.
      // When the LLM provides its own technicalConcepts, its reasoning about
      // the user's actual intent is superior to the word-by-word dictionary.
      if (technicalConcepts.length === 0 && preTrans?.dictionaryConcepts) {
        for (const dc of preTrans.dictionaryConcepts) {
          if (!technicalConcepts.includes(dc)) technicalConcepts.push(dc);
        }
      }

      // Synonym expansion: ONLY use as fallback when LLM produced no
      // expandedKeywords. When the LLM provides good keywords, don't dilute
      // them with dictionary synonyms that may be too narrow.
      if (expandedKeywords.length === 0 && preTrans?.expandedKeywords) {
        for (const s of preTrans.expandedKeywords) {
          if (!expandedKeywords.includes(s)) expandedKeywords.push(s);
        }
      }
      // Also run synonym expansion only when we're using the dictionary fallback
      if (expandedKeywords.length === 0) {
        const translatedParts = englishTranslation
          ? englishTranslation.split(/\s+/)
          : [];
        const localSynonyms = expandGithubSynonyms(effectiveDescription.toLowerCase(), translatedParts);
        for (const s of localSynonyms) {
          if (!expandedKeywords.includes(s)) expandedKeywords.push(s);
        }
      }

      // Deterministic intent: only use when the LLM didn't produce a useful intent.
      if (!criteria.intent || criteria.intent === 'other') {
        const localIntent = preTrans?.intent ?? classifyVietnameseIntent(effectiveDescription);
        if (localIntent) criteria.intent = localIntent;
      }

      // ── Deterministic query slot: inject tech-concepts as a search query ──
      // The LLM sometimes produces vague translations. If we extracted specific
      // tech concepts (e.g., "docker", "ci-cd"), construct a concise 2-4 word
      // query from them and replace/supplement the weakest LLM query.
      // This fills at most 1 keyword slot — no extra GitHub API calls.
      if (technicalConcepts.length >= 2 && queries.length < 3) {
        const conceptQuery = technicalConcepts.slice(0, 3).join(' ');
        // Only add if meaningfully different from existing queries
        const isDuplicate = queries.some(q =>
          levenshteinSimilarity(q.toLowerCase().replace(/[^\w\s]/g, ''), conceptQuery.toLowerCase().replace(/[^\w\s]/g, '')) > 0.6
        );
        if (!isDuplicate) {
          queries.push(conceptQuery);
        }
      } else if (technicalConcepts.length >= 2 && queries.length >= 3) {
        // All 3 slots are full — replace the worst LLM query if a concept
        // query is more specific. Heuristic: prefer concept query over the
        // shortest existing query (shortest = most likely to be vague).
        const conceptQuery = technicalConcepts.slice(0, 3).join(' ');
        const isDuplicate = queries.some(q =>
          levenshteinSimilarity(q.toLowerCase().replace(/[^\w\s]/g, ''), conceptQuery.toLowerCase().replace(/[^\w\s]/g, '')) > 0.6
        );
        if (!isDuplicate) {
          // Find the shortest query (least specific) and replace it
          const shortestIdx = queries.reduce((minIdx, q, i) =>
            q.length < queries[minIdx].length ? i : minIdx, 0);
          // Only replace if concept query is longer than the shortest
          if (conceptQuery.length > queries[shortestIdx].length) {
            queries[shortestIdx] = conceptQuery;
          }
        }
      }
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
      minStars: 0, // Not sent to GitHub API — applied as client-side post-filter
      license: filters?.license ?? criteria.preferredLicense ?? undefined,
      sort: 'stars',
      order: 'desc',
      perPage: 10,
    };
  }

  buildSearchParamsArray(criteria: SearchCriteria, filters?: { language?: string | null; license?: string | null; minStars?: number }): SearchParams[] {
    // NOTE: minStars is NOT sent to GitHub API — applied as client-side post-filter.
    // Setting minStars: 0 here ensures we get broad results and cache efficiently.
    const baseParams = criteria.keywords.map((keyword) => ({
      query: keyword,
      language: filters?.language ?? undefined,
      minStars: 0,
      license: filters?.license ?? criteria.preferredLicense ?? undefined,
      sort: 'stars' as const,
      order: 'desc' as const,
      perPage: 10,
    }));

    // Add expanded keyword variants (from multilingual translation)
    // These are additional search queries for broader coverage.
    //
    // IMPORTANT: Skip generic single-word expanded keywords (e.g., "management",
    // "tool", "admin") as standalone GitHub queries. These match millions of
    // repos and, since GitHub sorts by stars, mega-repos unrelated to the user's
    // actual domain dominate the results. Only use multi-word expanded keywords
    // (e.g., "canteen management", "food-service-management") or domain-specific
    // single words (e.g., "canteen", "cafeteria") as standalone queries.
    if (criteria.expandedKeywords && criteria.expandedKeywords.length > 0) {
      for (const expanded of criteria.expandedKeywords) {
        // Only add if not too similar to existing queries
        const normalizedExpanded = expanded.toLowerCase().replace(/[^\w\s]/g, '').trim();

        // Skip generic single-word expanded keywords — they match too many repos.
        // Check against ENGLISH_GENERIC_TERMS and also filter single words that
        // are broad English nouns (management, manager, admin, etc.).
        const expandedLower = expanded.toLowerCase().trim();
        const isSingleWord = !expandedLower.includes(' ') && !expandedLower.includes('-');
        const isGeneric = ENGLISH_GENERIC_TERMS.has(expandedLower) ||
          (isSingleWord && EXPANDED_KEYWORD_STOPWORDS.has(expandedLower));
        if (isGeneric) continue;

        const isDuplicate = baseParams.some((p) => {
          const normalizedExisting = p.query.toLowerCase().replace(/[^\w\s]/g, '').trim();
          return normalizedExisting === normalizedExpanded ||
            levenshteinSimilarity(normalizedExisting, normalizedExpanded) > 0.7;
        });
        if (!isDuplicate) {
          baseParams.push({
            query: expanded,
            language: filters?.language ?? undefined,
            minStars: 0,
            license: filters?.license ?? criteria.preferredLicense ?? undefined,
            sort: 'stars' as const,
            order: 'desc' as const,
            perPage: 10,
          });
        }
      }
    }

    // ── Vietnamese diacritics-stripped search variants ──
    // GitHub's search index handles diacritics inconsistently. A Vietnamese
    // query like "quản lý" should also match repos with "quan-ly" or "quan ly"
    // in name/description (common in Vietnamese GitHub repos). We derive
    // diacritics-stripped variants from originalQuery (the Vietnamese text),
    // not from keywords (which are English). No extra API calls.
    if (criteria.originalQuery && detectVietnamese(criteria.originalQuery) >= 0.3) {
      const originalLower = criteria.originalQuery.toLowerCase();
      // Split Vietnamese query into meaningful chunks and strip diacritics
      // e.g., "quản lý mật khẩu" → ["quan", "ly", "mat", "khau"] → queries
      // Use length >= 2 because Vietnamese words like "lý" (2 chars) are
      // meaningful — stop words are filtered separately below.
      const viWords = originalLower.split(/[\s,;.!?(){}[\]]+/).filter(w => w.length >= 2);
      if (viWords.length >= 2) {
        // Build a stripped stop-word set once — used for both full slug and sub-chunks.
        // VIETNAMESE_STOP_WORDS contains diacritic forms ("tôi", "muốn") so we
        // also need the diacritics-stripped forms ("toi", "muon") to filter
        // stripped words.
        const strippedStopWords = new Set(
          [...VIETNAMESE_STOP_WORDS].map(w => normalizeDiacritics(w).toLowerCase())
        );
        const isStopWord = (w: string) =>
          VIETNAMESE_STOP_WORDS.has(w) || strippedStopWords.has(w);

        // Full-query slug from MEANINGFUL words only (no stop words).
        // "quản lý mật khẩu" → "quan-ly-mat-khau"
        // "tôi muốn một công cụ quản lý căn tin" → "cong-cu-quan-ly-can-tin"
        // (stop words "tôi", "muốn", "một" stripped — they're noise in GitHub search)
        const meaningfulViWords = viWords.filter(w => !isStopWord(w));
        const fullSlug = meaningfulViWords
          .map(w => normalizeDiacritics(w).toLowerCase().replace(/[^\w-]/g, ''))
          .filter(w => w.length >= 2)
          .join('-');
        const isDuplicate = baseParams.some((p) => {
          const n = p.query.toLowerCase().replace(/[^\w\s-]/g, '').trim();
          return levenshteinSimilarity(n, fullSlug) > 0.7;
        });
        if (!isDuplicate && fullSlug.length >= 4) {
          baseParams.push({
            query: fullSlug,
            language: filters?.language ?? undefined,
            minStars: 0,
            license: filters?.license ?? criteria.preferredLicense ?? undefined,
            sort: 'stars' as const,
            order: 'desc' as const,
            perPage: 10,
          });
        }

        // Also try the most meaningful 3-word sub-phrases stripped.
        // Only generate sub-chunks from meaningful (non-stop-word) words, and
        // only 3-word chunks — 2-word chunks from diacritics-stripped Vietnamese
        // are too noisy. Sub-chunks of filler-stripped queries like
        // "công cụ quản lý căn tin" → "cong-quan-can", "quan-can-tin" are noise
        // that GitHub matches against random repos. With only 4 meaningful
        // words (cong, cu, quan, ly, can, tin) we get 1 sub-chunk at most.
        const strippedWords = viWords.map(w => normalizeDiacritics(w).toLowerCase().replace(/[^\w-]/g, ''));
        const meaningfulStripped = strippedWords.filter(w =>
          w.length >= 3 && !isStopWord(w)
        );
        // Only generate sub-chunks from meaningful words, and only 3-word chunks
        // (2-word chunks from diacritics-stripped Vietnamese are too noisy).
        if (meaningfulStripped.length >= 3) {
          for (let start = 0; start <= meaningfulStripped.length - 3; start++) {
            const chunk = meaningfulStripped.slice(start, start + 3).join('-');
            if (chunk.length >= 8) {
              const isChunkDupe = baseParams.some((p) => {
                const n = p.query.toLowerCase().replace(/[^\w\s-]/g, '').trim();
                return levenshteinSimilarity(n, chunk) > 0.7;
              });
              if (!isChunkDupe) {
                baseParams.push({
                  query: chunk,
                  language: filters?.language ?? undefined,
                  minStars: 0,
                  license: filters?.license ?? criteria.preferredLicense ?? undefined,
                  sort: 'stars' as const,
                  order: 'desc' as const,
                  perPage: 10,
                });
              }
            }
          }
        }
      }

      // Also strip diacritics from any keywords that happen to contain Vietnamese
      // (edge case: LLM might include Vietnamese in keywords)
      for (const kw of criteria.keywords) {
        const stripped = normalizeDiacritics(kw).toLowerCase().replace(/[^\w\s-]/g, '').trim();
        if (stripped && stripped !== kw.toLowerCase() && stripped.length >= 3) {
          const hyphenated = stripped.replace(/\s+/g, '-');
          const isDuplicate = baseParams.some((p) => {
            const n = p.query.toLowerCase().replace(/[^\w\s-]/g, '').trim();
            return n === stripped || n === hyphenated ||
              levenshteinSimilarity(n, stripped) > 0.7;
          });
          if (!isDuplicate) {
            baseParams.push({
              query: hyphenated.length >= stripped.length ? hyphenated : stripped,
              language: filters?.language ?? undefined,
              minStars: 0,
              license: filters?.license ?? criteria.preferredLicense ?? undefined,
              sort: 'stars' as const,
              order: 'desc' as const,
              perPage: 10,
            });
          }
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
      negSpaceBlock = `Missing from results: ${negSpace.gaps.slice(0, 5).map(g => `${g.keyword} (${g.presence}%)`).join(', ')}. Suggest broader terms for these gaps.`;
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
    precomputedIsVietnamese?: boolean,
  ): Promise<SearchCriteria> {
    // ── Vietnamese refinement detection ──
    // If the original query was Vietnamese OR the refinement text is Vietnamese,
    // pre-compute a deterministic translation to inject into the LLM prompt.
    // This ensures the LLM understands Vietnamese refinement text without
    // guessing translations of domain terms.
    const isOriginalVietnamese = originalCriteria.originalQuery != null;
    const refinementIsVietnamese = !isOriginalVietnamese && detectVietnamese(refinementText) >= 0.3;
    const needsViContext = isOriginalVietnamese || refinementIsVietnamese;

    const preTrans = needsViContext
      ? quickVietnameseTranslateStructured(refinementText)
      : null;

    // Build pre-context block for Vietnamese refinement
    const preContext = preTrans
      ? `\n\nVietnamese refinement — ALREADY TRANSLATED:\n  English: "${preTrans.translation}"${preTrans.intent ? `\n  Intent: ${preTrans.intent}` : ''}${preTrans.techTerms.length > 0 ? `\n  Tech terms: ${preTrans.techTerms.slice(0, 6).join(', ')}` : ''}${preTrans.dictionaryConcepts.length > 0 ? `\n  Dict concepts: ${preTrans.dictionaryConcepts.slice(0, 6).join(', ')}` : ''}\n\nUse the provided English translation as the basis for the refinement. Do NOT invent different translations.`
      : '';

    // Include Vietnamese context from original criteria in the prompt
    const originalViBlock = originalCriteria.englishTranslation
      ? `\nOriginal English translation: "${originalCriteria.englishTranslation}"${originalCriteria.originalQuery ? `\nOriginal Vietnamese query: "${originalCriteria.originalQuery}"` : ''}${originalCriteria.technicalConcepts?.length ? `\nOriginal tech concepts: ${originalCriteria.technicalConcepts.join(', ')}` : ''}${originalCriteria.expandedKeywords?.length ? `\nOriginal expanded keywords: ${originalCriteria.expandedKeywords.slice(0, 5).join(', ')}` : ''}`
      : originalCriteria.originalQuery
        ? `\nOriginal Vietnamese query: "${originalCriteria.originalQuery}"${originalCriteria.technicalConcepts?.length ? `\nOriginal tech concepts: ${originalCriteria.technicalConcepts.join(', ')}` : ''}`
        : '';

    const prompt = `You are a GitHub search expert. A user searched for repositories and wants to refine the results.${preContext}

Original request: "${originalRequest}"${originalViBlock}

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
  "intent": "web-app | cli-tool | library | api | mobile-app | desktop-app | devops-tool | ai-ml-tool | database | networking-tool | security-tool | retail-pos | other",
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
  }${needsViContext ? ',\n  "englishTranslation": "English translation of the refined search intent",\n  "technicalConcepts": ["extracted technical concepts in English"]' : ''}
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
      englishTranslation?: string;
      technicalConcepts?: string[];
    }>(raw);

    // ── Propagate Vietnamese fields through refinement ──
    // After refinement, the original Vietnamese context must still flow into
    // the ranking engine and buildSearchParamsArray. The LLM may produce new
    // englishTranslation + technicalConcepts in the refinement response; those
    // take priority. If the LLM didn't produce them, fall back to the original
    // criteria values. If neither exists, fall back to preTrans (deterministic).
    const newTranslation = parsed.englishTranslation
      ?? originalCriteria.englishTranslation
      ?? preTrans?.translation;

    const newTechConcepts = parsed.technicalConcepts?.length
      ? parsed.technicalConcepts
      : originalCriteria.technicalConcepts?.length
        ? originalCriteria.technicalConcepts
        : preTrans?.techTerms;

    // Merge preTrans tech terms into tech concepts (deterministic enrichment)
    const mergedConcepts = newTechConcepts ? [...newTechConcepts] : [];
    if (preTrans?.techTerms) {
      for (const t of preTrans.techTerms) {
        if (!mergedConcepts.includes(t)) mergedConcepts.push(t);
      }
    }
    if (preTrans?.dictionaryConcepts) {
      for (const dc of preTrans.dictionaryConcepts) {
        if (!mergedConcepts.includes(dc)) mergedConcepts.push(dc);
      }
    }

    // Build expanded keywords from preTrans + original
    const expandedKeywords: string[] = [];
    if (originalCriteria.expandedKeywords) {
      expandedKeywords.push(...originalCriteria.expandedKeywords);
    }
    if (preTrans?.expandedKeywords) {
      for (const ek of preTrans.expandedKeywords) {
        if (!expandedKeywords.includes(ek)) expandedKeywords.push(ek);
      }
    }

    // Carry forward originalQuery (Vietnamese or original)
    const originalQuery = originalCriteria.originalQuery
      ?? (refinementIsVietnamese ? refinementText : undefined);

    return {
      keywords: parsed.keywords ?? originalCriteria.keywords,
      technologies: parsed.technologies ?? originalCriteria.technologies,
      intent: parsed.intent ?? originalCriteria.intent,
      useCase: originalRequest,
      minStars: typeof parsed.minStars === 'number' ? parsed.minStars : originalCriteria.minStars,
      preferredLicense: parsed.preferredLicense !== undefined ? parsed.preferredLicense : originalCriteria.preferredLicense,
      requireRecentActivity: parsed.requireRecentActivity ?? originalCriteria.requireRecentActivity,
      weightEmphasis: parsed.weightEmphasis,
      // Vietnamese fields — propagate through refinement
      ...(originalQuery || newTranslation ? {
        originalQuery,
        englishTranslation: newTranslation,
        technicalConcepts: mergedConcepts.length > 0 ? mergedConcepts : undefined,
        expandedKeywords: expandedKeywords.length > 0 ? expandedKeywords : undefined,
      } : {}),
    };
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
