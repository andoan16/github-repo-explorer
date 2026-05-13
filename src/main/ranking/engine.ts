import type { GitHubRepo, RelevanceScore, WeightEmphasis } from '../../shared/types';
import type { SearchCriteria } from '../../shared/types';

export class RankingEngine {
  scoreRepo(repo: GitHubRepo, criteria: SearchCriteria, readme: string | null, userRequest: string, emphasis?: WeightEmphasis): RelevanceScore {
    const starsScore = this.normalizeStars(repo.stars);
    const activityScore = this.activitySignal(repo.updated_at);
    const languageMatch = this.matchLanguage(repo.language, criteria.technologies);
    const licenseCompatibility = this.matchLicense(repo.license?.key ?? null, criteria.preferredLicense);
    const readmeRelevance = this.readmeSignal(readme, criteria.keywords);
    const semanticMatch = this.baseSemanticScore(repo, criteria, userRequest);

    const defaultWeights = {
      semanticMatch: 0.30,
      starsScore: 0.20,
      activityScore: 0.15,
      readmeRelevance: 0.15,
      languageMatch: 0.10,
      licenseCompatibility: 0.10,
    };

    const effectiveWeights = emphasis
      ? { ...defaultWeights }
      : defaultWeights;

    if (emphasis) {
      effectiveWeights.semanticMatch *= emphasis.semanticMatch;
      effectiveWeights.starsScore *= emphasis.starsScore;
      effectiveWeights.activityScore *= emphasis.activityScore;
      effectiveWeights.readmeRelevance *= emphasis.readmeRelevance;
      effectiveWeights.languageMatch *= emphasis.languageMatch;
      effectiveWeights.licenseCompatibility *= emphasis.licenseCompatibility;

      // Normalize so weights sum to 1.0
      const sum = Object.values(effectiveWeights).reduce((a, b) => a + b, 0);
      for (const key of Object.keys(effectiveWeights) as (keyof typeof effectiveWeights)[]) {
        effectiveWeights[key] /= sum;
      }
    }

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

  rank(
    repos: GitHubRepo[],
    criteria: SearchCriteria,
    readmes: Map<number, string | null>,
    userRequest: string,
    maxResults: number,
    emphasis?: WeightEmphasis,
  ): { repo: GitHubRepo; score: RelevanceScore }[] {
    const scored = repos
      .filter((r) => !r.archived)
      .map((repo) => ({
        repo,
        score: this.scoreRepo(repo, criteria, readmes.get(repo.id) ?? null, userRequest, emphasis),
      }));

    scored.sort((a, b) => b.score.total - a.score.total);
    return scored.slice(0, maxResults);
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
    const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of', 'is', 'it', 'as', 'at', 'be', 'by']);
    const tokens = new Set<string>();
    for (const kw of keywords) {
      for (const word of kw.toLowerCase().split(/\s+/)) {
        const w = word.trim();
        if (w.length >= 2 && !stopWords.has(w)) tokens.add(w);
      }
    }
    return [...tokens];
  }

  private readmeSignal(readme: string | null, keywords: string[]): number {
    if (!readme || keywords.length === 0) return 0.5;
    const text = readme.toLowerCase();
    const tokens = this.tokenize(keywords);
    if (tokens.length === 0) return 0.5;
    let hits = 0;
    for (const t of tokens) {
      if (text.includes(t)) hits++;
    }
    return Math.min(1, hits / tokens.length);
  }

  private baseSemanticScore(repo: GitHubRepo, criteria: SearchCriteria, userRequest: string): number {
    let score = 0.3;
    const desc = (repo.description ?? '').toLowerCase();
    const topics = repo.topics.map((t) => t.toLowerCase());
    const fullName = repo.full_name.toLowerCase();
    const tokens = this.tokenize(criteria.keywords);

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

    if (repo.topics.length >= 5) score += 0.04;
    if ((repo.description?.length ?? 0) > 50) score += 0.02;

    return Math.min(1, score);
  }
}
