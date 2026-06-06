import type { GitHubRepo, RelevanceScore, WeightEmphasis } from '../../shared/types';
import type { SearchCriteria } from '../../shared/types';
import { normalizeDiacritics } from '../search/vietnamese';

/** Precomputed default weights — avoids per-repo allocation on every score call. */
const DEFAULT_WEIGHTS: Required<WeightEmphasis> = {
  semanticMatch: 0.30,
  starsScore: 0.20,
  activityScore: 0.15,
  readmeRelevance: 0.15,
  languageMatch: 0.10,
  licenseCompatibility: 0.10,
};

function computeNormalized(emphasis: WeightEmphasis): Required<WeightEmphasis> {
  const w = {
    semanticMatch: DEFAULT_WEIGHTS.semanticMatch * emphasis.semanticMatch,
    starsScore: DEFAULT_WEIGHTS.starsScore * emphasis.starsScore,
    activityScore: DEFAULT_WEIGHTS.activityScore * emphasis.activityScore,
    readmeRelevance: DEFAULT_WEIGHTS.readmeRelevance * emphasis.readmeRelevance,
    languageMatch: DEFAULT_WEIGHTS.languageMatch * emphasis.languageMatch,
    licenseCompatibility: DEFAULT_WEIGHTS.licenseCompatibility * emphasis.licenseCompatibility,
  };
  const sum = w.semanticMatch + w.starsScore + w.activityScore + w.readmeRelevance + w.languageMatch + w.licenseCompatibility;
  w.semanticMatch /= sum;
  w.starsScore /= sum;
  w.activityScore /= sum;
  w.readmeRelevance /= sum;
  w.languageMatch /= sum;
  w.licenseCompatibility /= sum;
  return w;
}

/** Hoisted stop words — avoids allocating a new Set on every tokenize() call. */
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of', 'is', 'it', 'as', 'at', 'be', 'by']);

/** Vietnamese stop words for use in original-query token matching. */
const VIET_STOP_WORDS = new Set([
  'tôi', 'muốn', 'cần', 'một', 'cho', 'và', 'hoặc', 'của', 'về', 'với',
  'để', 'sẽ', 'đã', 'đang', 'cũng', 'này', 'đó', 'có', 'không', 'nhưng',
  'từ', 'trong', 'ra', 'vào', 'lên', 'xuống', 'nữa', 'rất', 'quá',
  'cái', 'những', 'các', 'vậy', 'thì', 'mà', 'nhé', 'ạ',
]);

/** Precomputed lowercase metadata per repo — avoids repeated .toLowerCase() calls in scoring. */
interface PrecomputedRepo {
  descLower: string;
  fullNameLower: string;
  topicsLower: string[];
}

export class RankingEngine {
  scoreRepo(
    repo: GitHubRepo,
    criteria: SearchCriteria,
    readme: string | null,
    userRequest: string,
    emphasis?: WeightEmphasis,
    preTokens?: string[],
    precomputedWeights?: Required<WeightEmphasis>,
    precomputed?: PrecomputedRepo,
  ): RelevanceScore {
    const tokens = preTokens ?? this.tokenize(criteria.keywords);
    const starsScore = this.normalizeStars(repo.stars);
    const activityScore = this.activitySignal(repo.updated_at);
    const languageMatch = this.matchLanguage(repo.language, criteria.technologies);
    const licenseCompatibility = this.matchLicense(repo.license?.key ?? null, criteria.preferredLicense);
    // Use multilingual README signal when criteria has translation fields
    const readmeRelevance = (criteria.englishTranslation || criteria.technicalConcepts?.length)
      ? this.readmeSignalMultilingual(readme, tokens, criteria)
      : this.readmeSignal(readme, tokens);
    let semanticMatch = this.baseSemanticScore(repo, criteria, tokens, precomputed);

    // Credibility penalty: repos with fewer than 100 stars get their semantic
    // match discounted. Prevents keyword-stuffed micro-repos from outranking
    // established projects with slightly different wording.
    if (repo.stars < 100) {
      semanticMatch *= 0.6; // 40% penalty
    } else if (repo.stars < 500) {
      semanticMatch *= 0.85; // 15% penalty
    }

    // Use pre-computed weights when available (computed once in rank() instead of per-repo)
    const effectiveWeights = precomputedWeights ?? (emphasis ? computeNormalized(emphasis) : DEFAULT_WEIGHTS);

    const total = Math.round(
      (semanticMatch * effectiveWeights.semanticMatch +
       starsScore * effectiveWeights.starsScore +
       activityScore * effectiveWeights.activityScore +
       readmeRelevance * effectiveWeights.readmeRelevance +
       languageMatch * effectiveWeights.languageMatch +
       licenseCompatibility * effectiveWeights.licenseCompatibility) * 100
    ) / 100;

    return {
      total,
      semanticMatch: Math.round(semanticMatch * 100) / 100,
      starsScore: Math.round(starsScore * 100) / 100,
      activityScore: Math.round(activityScore * 100) / 100,
      readmeRelevance: Math.round(readmeRelevance * 100) / 100,
      languageMatch: Math.round(languageMatch * 100) / 100,
      licenseCompatibility: Math.round(licenseCompatibility * 100) / 100,
    };
  }

  async rank(
    repos: GitHubRepo[],
    criteria: SearchCriteria,
    readmes: Map<number, string | null>,
    userRequest: string,
    maxResults: number,
    emphasis?: WeightEmphasis,
  ): Promise<{ repo: GitHubRepo; score: RelevanceScore }[]> {
    const candidates = repos.filter((r) => !r.archived);
    const tokens = this.tokenize(criteria.keywords);

    // Compute normalized weights ONCE instead of per-repo
    const precomputedWeights = emphasis ? computeNormalized(emphasis) : DEFAULT_WEIGHTS;

    // Pre-compute lowercase metadata for all candidates (avoids repeated .toLowerCase() per scoring signal)
    const precomputedMap = new Map<number, PrecomputedRepo>();
    for (const repo of candidates) {
      precomputedMap.set(repo.id, {
        descLower: (repo.description ?? '').toLowerCase(),
        fullNameLower: repo.full_name.toLowerCase(),
        topicsLower: repo.topics.map(t => t.toLowerCase()),
      });
    }

    if (candidates.length <= maxResults) {
      const scored = candidates.map((repo) => ({
        repo,
        score: this.scoreRepo(repo, criteria, readmes.get(repo.id) ?? null, userRequest, emphasis, tokens, precomputedWeights, precomputedMap.get(repo.id)),
      }));
      scored.sort((a, b) => b.score.total - a.score.total);
      return scored;
    }

    // Heap-based top-K: O(n log k) instead of O(n log n)
    const heap: { repo: GitHubRepo; score: RelevanceScore }[] = [];
    // Only yield for very large datasets — 50 repos completes in microseconds
    const BATCH_SIZE = 100;

    for (let i = 0; i < candidates.length; i++) {
      const repo = candidates[i];
      const score = this.scoreRepo(repo, criteria, readmes.get(repo.id) ?? null, userRequest, emphasis, tokens, precomputedWeights, precomputedMap.get(repo.id));
      const entry = { repo, score };

      if (heap.length < maxResults) {
        heap.push(entry);
        if (heap.length === maxResults) {
          heapifyMin(heap);
        }
      } else if (entry.score.total > heap[0].score.total) {
        heap[0] = entry;
        siftDown(heap, 0, heap.length);
      }

      // Yield event loop only for large datasets
      if (BATCH_SIZE >= 100 && (i + 1) % BATCH_SIZE === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    // Sort descending for output
    heap.sort((a, b) => b.score.total - a.score.total);
    return heap;
  }

  private normalizeStars(stars: number): number {
    if (stars <= 0) return 0;
    if (stars >= 100000) return 1;
    return Math.log10(stars) / 5;
  }

  private activitySignal(updatedAt: string): number {
    if (!updatedAt) return 0;
    const now = Date.now();
    const updated = new Date(updatedAt).getTime();
    const monthsAgo = (now - updated) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo <= 1) return 1;
    if (monthsAgo >= 36) return 0;
    return Math.max(0, 1 - monthsAgo / 36);
  }

  private matchLanguage(repoLanguage: string | null, wantedTechs: string[]): number {
    if (!repoLanguage || wantedTechs.length === 0) return 0.5;
    const langLower = repoLanguage.toLowerCase();
    for (const tech of wantedTechs) {
      const techLower = tech.toLowerCase();
      if (langLower === techLower) return 1;
      // Partial match: only score 0.7 if both are at least 3 chars and one
      // is a genuine prefix/suffix match (not a false positive like "script" ⊂ "typescript").
      // Use word-boundary check: the match must start after a non-alpha char or at position 0.
      if (techLower.length >= 3) {
        const idx = langLower.indexOf(techLower);
        if (idx !== -1 && (idx === 0 || !/[a-z]/.test(langLower[idx - 1]))) return 0.7;
        const rIdx = techLower.indexOf(langLower);
        if (rIdx !== -1 && (rIdx === 0 || !/[a-z]/.test(techLower[rIdx - 1]))) return 0.7;
      }
    }
    return 0.2;
  }

  private matchLicense(repoLicense: string | null, preferred: string | null): number {
    if (!preferred) return 0.8;
    if (!repoLicense) return 0.5;
    if (repoLicense.toLowerCase() === preferred.toLowerCase()) return 1;
    const permissive = ['mit', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause', 'isc', 'unlicense'];
    const isPermissive = permissive.includes(repoLicense.toLowerCase());
    const prefPermissive = permissive.includes(preferred.toLowerCase());
    if (isPermissive && prefPermissive) return 0.85;
    return 0.4;
  }

  private tokenize(keywords: string[]): string[] {
    const tokens = new Set<string>();
    for (const kw of keywords) {
      for (const word of kw.toLowerCase().split(/\s+/)) {
        const w = word.trim();
        if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.add(w);
      }
    }
    return [...tokens];
  }

  private readmeSignal(readme: string | null, tokens: string[]): number {
    if (!readme || tokens.length === 0) return 0;
    const text = readme.toLowerCase();
    let hits = 0;
    for (const t of tokens) {
      if (text.includes(t)) hits++;
    }
    return Math.min(1, hits / tokens.length);
  }

  /**
   * Compute README signal with multilingual expansion.
   * Same as readmeSignal but also checks translated tokens.
   */
  readmeSignalMultilingual(readme: string | null, tokens: string[], criteria: SearchCriteria): number {
    // When readme is null/empty, we have no signal — return 0 (neutral) instead of 0.5.
    // Returning 0.5 for null readmes was inflating scores for repos whose readmes
    // we haven't even loaded yet.
    if (!readme || tokens.length === 0) return 0;
    const text = readme.toLowerCase();
    let hits = 0;
    const allTokens = [...tokens];

    // Add English translation tokens
    if (criteria.englishTranslation) {
      allTokens.push(...this.tokenize([criteria.englishTranslation]));
    }
    if (criteria.technicalConcepts) {
      allTokens.push(...criteria.technicalConcepts.map(c => c.toLowerCase()));
    }

    const uniqueTokens = [...new Set(allTokens)];
    for (const t of uniqueTokens) {
      if (text.includes(t)) hits++;
    }
    return Math.min(1, hits / uniqueTokens.length);
  }

  /** Map intent slugs to canonical GitHub topic clusters.
   *  When a repo's topics overlap the cluster for the user's intent, it gets a
   *  relevance boost — even when keyword matching misses (e.g., "devops-tool" intent
   *  boosts repos with topics like "ci-cd", "continuous-integration" even if the
   *  query keywords didn't include those exact strings). */
  private static readonly INTENT_TOPIC_CLUSTERS: Record<string, string[]> = {
    'devops-tool': ['ci-cd', 'continuous-integration', 'continuous-delivery', 'continuous-deployment', 'devops', 'automation', 'pipeline', 'cicd'],
    'database': ['database', 'sql', 'nosql', 'orm', 'migration', 'postgres', 'mysql', 'mongodb', 'redis', 'sqlite', 'mariadb', 'cassandra', 'cockroachdb'],
    'monitoring': ['monitoring', 'observability', 'logging', 'tracing', 'alerting', 'metrics', 'apm', 'prometheus', 'grafana', 'datadog'],
    'containerization': ['docker', 'container', 'kubernetes', 'k8s', 'orchestration', 'podman', 'containerd'],
    'authentication': ['authentication', 'oauth', 'sso', 'identity', 'saml', 'ldap', 'auth', 'login', 'permissions', 'rbac'],
    'web-framework': ['web', 'http', 'rest', 'api', 'frontend', 'backend', 'fullstack', 'ssr', 'spa', 'nextjs', 'nuxt', 'svelte'],
    'testing': ['testing', 'test', 'e2e', 'unit-testing', 'integration-testing', 'tdd', 'pytest', 'jest', 'cypress'],
    'ai-ml-tool': ['machine-learning', 'deep-learning', 'neural-network', 'nlp', 'computer-vision', 'ai', 'ml', 'llm', 'transformer', 'pytorch', 'tensorflow', 'model', 'inference', 'training'],
    'security-tool': ['security', 'encryption', 'vulnerability', 'pentesting', 'firewall', 'compliance', 'tls', 'crypto'],
    'password-manager': ['password', 'vault', 'credentials', 'secrets', 'credential-manager'],
    'self-hosted': ['self-hosted', 'homelab', 'on-premise', 'deployment', 'hosting'],
    'networking-tool': ['networking', 'proxy', 'gateway', 'vpn', 'dns', 'load-balancer', 'cdn', 'traefik', 'caddy', 'nginx'],
    'messaging': ['chat', 'messaging', 'irc', 'matrix', 'xmpp', 'websocket', 'pubsub'],
    'cli-tool': ['cli', 'terminal', 'shell', 'command-line', 'tui'],
    'automation': ['automation', 'bot', 'script', 'workflow', 'cron', 'scheduler'],
    'web-app': ['web', 'http', 'rest', 'api', 'frontend', 'backend', 'fullstack', 'ssr', 'spa', 'nextjs', 'nuxt', 'svelte'],
    'mobile-app': ['mobile', 'ios', 'android', 'react-native', 'flutter', 'swift', 'kotlin'],
    'library': ['library', 'lib', 'package', 'module', 'sdk', 'framework'],
  };

  private baseSemanticScore(repo: GitHubRepo, criteria: SearchCriteria, tokens: string[], precomputed?: PrecomputedRepo): number {
    let score = 0.3;
    const desc = precomputed?.descLower ?? (repo.description ?? '').toLowerCase();
    const topics = precomputed?.topicsLower ?? repo.topics.map((t) => t.toLowerCase());
    const fullName = precomputed?.fullNameLower ?? repo.full_name.toLowerCase();

    // Token-level matching (more granular, handles multi-word query strings)
    for (const token of tokens) {
      if (fullName.includes(token)) score += 0.12;
      if (desc.includes(token)) score += 0.08;
      if (topics.some((t) => t.includes(token))) score += 0.06;
    }

    // Phrase-level: also check the original keyword strings as whole phrases
    for (const kw of criteria.keywords) {
      const k = kw.toLowerCase();
      if (k.length >= 4 && fullName.includes(k)) score += 0.1;
      if (k.length >= 4 && desc.includes(k)) score += 0.06;
    }

    for (const tech of criteria.technologies) {
      const t = tech.toLowerCase();
      if (desc.includes(t) || topics.includes(t)) score += 0.08;
    }

    // ── UseCase phrase matching ──
    // useCase (e.g., "Self-hosted CI/CD platform") encodes the user's specific scenario.
    // Break it into sub-phrases and check each against description and topics.
    // This catches repos like "Drone - Continuous Delivery" whose description matches
    // the "continuous delivery" sub-phrase of the useCase, even when no individual
    // keyword token matched.
    const useCaseLower = criteria.useCase?.toLowerCase() ?? '';
    if (useCaseLower.length >= 4) {
      // Split useCase into phrase chunks (separated by commas, semicolons, or " - ")
      const useCasePhrases = useCaseLower.split(/[,;]/).map(p => p.trim()).filter(p => p.length >= 4);
      for (const phrase of useCasePhrases) {
        if (desc.includes(phrase)) score += 0.07;
        // Also check each 2+ word sub-phrase of the useCase
        const words = phrase.split(/\s+/);
        if (words.length >= 2) {
          // Sliding window of 2-word and 3-word phrases
          for (let w = 2; w <= Math.min(3, words.length); w++) {
            for (let i = 0; i <= words.length - w; i++) {
              const subPhrase = words.slice(i, i + w).join(' ');
              if (subPhrase.length >= 4 && desc.includes(subPhrase)) score += 0.04;
              if (subPhrase.length >= 4 && topics.some(t => t.includes(subPhrase.replace(/\s+/g, '-')))) score += 0.03;
            }
          }
        }
      }
    }

    // ── Vietnamese-aware useCase decomposition ──
    // When originalQuery is set, useCase holds the raw Vietnamese text, which won't
    // match English repo descriptions well. Also decompose the English translation
    // and expandedKeywords as useCase sub-phrases for better phrase-level matching.
    if (criteria.originalQuery && criteria.englishTranslation) {
      const engPhrases = criteria.englishTranslation.toLowerCase()
        .split(/[,;]/).map(p => p.trim()).filter(p => p.length >= 4);
      for (const phrase of engPhrases) {
        if (desc.includes(phrase)) score += 0.05;
        const words = phrase.split(/\s+/);
        if (words.length >= 2) {
          for (let w = 2; w <= Math.min(3, words.length); w++) {
            for (let i = 0; i <= words.length - w; i++) {
              const subPhrase = words.slice(i, i + w).join(' ');
              if (subPhrase.length >= 4 && desc.includes(subPhrase)) score += 0.03;
              if (subPhrase.length >= 4 && topics.some(t => t.includes(subPhrase.replace(/\s+/g, '-')))) score += 0.02;
            }
          }
        }
      }
    }

    // ── Intent-topic alignment ──
    // Repos with topics in the same domain as the user's intent get a boost.
    // This is critical for queries like "self-hosted CI/CD" where the intent is "devops-tool"
    // — a repo like gitea with topic "continuous-integration" should rank higher than a
    // generic "self-hosted" repo without devops topics, even if gitea's description
    // doesn't contain every query keyword.
    const intentSlug = criteria.intent.toLowerCase().replace(/[_\s-]+/g, '-');
    const cluster = RankingEngine.INTENT_TOPIC_CLUSTERS[intentSlug];
    if (cluster) {
      const overlap = topics.filter(t => cluster.some(c => t === c || t.replace(/[_\-]/g, '-') === c));
      if (overlap.length > 0) {
        score += Math.min(0.15, overlap.length * 0.05);
      }
    }

    // ── Cross-language semantic matching ──
    // When the user searched in Vietnamese, English translations and
    // technical concepts should also boost the score if they appear in
    // repo metadata. This ensures repos with English descriptions
    // aren't penalized when the user searched in Vietnamese.
    if (criteria.englishTranslation) {
      const translationTokens = this.tokenize([criteria.englishTranslation]);
      for (const token of translationTokens) {
        if (fullName.includes(token)) score += 0.10;
        if (desc.includes(token)) score += 0.07;
        if (topics.some((t) => t.includes(token))) score += 0.05;
      }
      // Also check the full translation as a phrase
      const englishLower = criteria.englishTranslation.toLowerCase();
      if (englishLower.length >= 4 && desc.includes(englishLower)) score += 0.06;
    }

    if (criteria.technicalConcepts && criteria.technicalConcepts.length > 0) {
      for (const concept of criteria.technicalConcepts) {
        const c = concept.toLowerCase();
        if (desc.includes(c) || topics.includes(c)) score += 0.07;
        if (fullName.includes(c)) score += 0.10;
      }
    }

    // ── Expanded keyword matching (Vietnamese synonym expansion) ──
    // expandedKeywords come from Vietnamese synonym expansion (e.g., "quản lý" →
    // ["management", "manager", "admin"]). A repo whose description or topics
    // contain one of these synonyms should get a smaller boost than primary
    // keywords (which already got a full token match), but enough to surface
    // relevant repos that use different terminology than the direct translation.
    if (criteria.expandedKeywords && criteria.expandedKeywords.length > 0) {
      for (const expanded of criteria.expandedKeywords) {
        const e = expanded.toLowerCase();
        if (desc.includes(e) || topics.some(t => t === e || t === e.replace(/\s+/g, '-'))) score += 0.04;
        if (fullName.includes(e)) score += 0.06;
      }
    }

    // ── Vietnamese original query matching ──
    // When the user searched in Vietnamese (originalQuery is set), also boost
    // repos whose metadata contains the Vietnamese keywords themselves or their
    // diacritics-stripped forms. Many GitHub repos have Vietnamese in slug-style
    // names (e.g., "quản-lý") or descriptions. Matching "quan ly" (stripped)
    // against "quan-ly" in full_name catches repos the English translation alone
    // would miss. Low weight to avoid over-boosting — this is a secondary signal.
    if (criteria.originalQuery) {
      const originalLower = criteria.originalQuery.toLowerCase();
      const originalTokens = originalLower.split(/[\s,;.!?(){}[\]]+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !VIET_STOP_WORDS.has(w));
      for (const token of originalTokens) {
        // Match the Vietnamese keyword directly (some repos have vn descriptions)
        if (fullName.includes(token) || desc.includes(token)) score += 0.03;
        // Match the diacritics-stripped version against slug-style names
        const stripped = normalizeDiacritics(token).toLowerCase();
        if (stripped !== token && stripped.length >= 3) {
          // "quản" → "quan", check against "quan" in full_name or description
          if (fullName.includes(stripped) || desc.includes(stripped)) score += 0.04;
          // Also check hyphenated form "quan-ly" which appears in GitHub slugs
          // for Vietnamese repo names
          const hyphenated = stripped.replace(/\s+/g, '-');
          if (hyphenated !== stripped && (fullName.includes(hyphenated) || desc.includes(hyphenated))) score += 0.04;
        }
      }
      // Also check the full original query as a hyphenated slug
      const fullSlug = normalizeDiacritics(originalLower.replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '').trim()).replace(/\s+/g, '-');
      if (fullSlug.length >= 4 && (fullName.includes(fullSlug) || desc.includes(fullSlug))) score += 0.05;
    }

    // ── Topic richness bonus (small flat boost for well-described repos) ──
    if (repo.topics.length >= 5) score += 0.04;
    if ((repo.description?.length ?? 0) > 50) score += 0.02;

    // ── Soft saturation: apply diminishing returns instead of a hard 1.0 cap ──
    // A hard Math.min(1, score) makes all repos above ~7 token matches
    // indistinguishable (all score 1.0), destroying rank discrimination.
    // The formula  score / (1 + score)  maps [0, ∞) → [0, 1) with natural
    // diminishing returns — every additional match still increases the score,
    // but the marginal gain shrinks as the total grows, and the value
    // asymptotically approaches 1 without ever reaching it.
    return score / (1 + score);
  }
}

// ── Min-heap helpers for top-K ranking ──

interface ScoredEntry {
  repo: GitHubRepo;
  score: RelevanceScore;
}

function heapifyMin(heap: ScoredEntry[]): void {
  for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
    siftDown(heap, i, heap.length);
  }
}

function siftDown(heap: ScoredEntry[], idx: number, size: number): void {
  while (true) {
    let smallest = idx;
    const left = 2 * idx + 1;
    const right = 2 * idx + 2;
    if (left < size && heap[left].score.total < heap[smallest].score.total) smallest = left;
    if (right < size && heap[right].score.total < heap[smallest].score.total) smallest = right;
    if (smallest === idx) break;
    [heap[idx], heap[smallest]] = [heap[smallest], heap[idx]];
    idx = smallest;
  }
}
