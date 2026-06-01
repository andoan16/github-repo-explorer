import type { GitHubRepo, RelevanceScore, WeightEmphasis } from '../../shared/types';
import type { SearchCriteria } from '../../shared/types';

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
      if (langLower === tech.toLowerCase()) return 1;
      if (langLower.includes(tech.toLowerCase()) || tech.toLowerCase().includes(langLower)) return 0.7;
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
    if (!readme || tokens.length === 0) return 0.5;
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
    if (!readme || tokens.length === 0) return 0.5;
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

    if (repo.topics.length >= 5) score += 0.04;
    if ((repo.description?.length ?? 0) > 50) score += 0.02;

    return Math.min(1, score);
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
