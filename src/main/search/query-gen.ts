import type { SearchCriteria, SearchParams, WeightEmphasis } from '../../shared/types';
import type { OllamaClient } from '../ollama/client';

export class QueryGenerator {
  constructor(private ollama: OllamaClient, private model: string) {}

  async extractCriteria(userDescription: string): Promise<SearchCriteria> {
    const prompt = `You are a GitHub search expert. Convert this user request into search criteria for the GitHub API.

User request: "${userDescription}"

Generate 3 alternative GitHub keyword queries (each 2-4 words), approaching the request from different angles (synonyms, broader/narrower scope, different technology emphasis).

Return ONLY valid JSON — no markdown, no code fences, no commentary:

{
  "searchQueries": ["2-4 keywords query 1", "2-4 keywords query 2", "2-4 keywords query 3"],
  "technologies": ["languages or frameworks mentioned or implied"],
  "intent": "web-app | cli-tool | library | api | mobile-app | desktop-app | devops-tool | ai-ml-tool | database | networking-tool | security-tool | other",
  "minStars": number (0-5000, default 0),
  "preferredLicense": "mit" | "apache-2.0" | "gpl-3.0" | "bsd-3-clause" | "mpl-2.0" | null,
  "requireRecentActivity": boolean
}

JSON:`;


    const raw = await this.ollama.generate(prompt, this.model);
    const criteria = this.parseJson<{
      searchQueries?: string[];
      searchQuery?: string;
      keywords?: string[];
      technologies?: string[];
      intent?: string;
      minStars?: number;
      preferredLicense?: string | null;
      requireRecentActivity?: boolean;
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

    // Pad to 3 queries if we got fewer
    while (queries.length < 3) {
      const words = userDescription.split(/\s+/);
      const start = (queries.length * Math.floor(words.length / 3)) % words.length;
      queries.push(words.slice(start, start + 3).join(' '));
    }

    return {
      keywords: queries.slice(0, 3),
      technologies: criteria.technologies ?? [],
      intent: criteria.intent ?? 'other',
      useCase: userDescription,
      minStars: typeof criteria.minStars === 'number' ? criteria.minStars : 0,
      preferredLicense: criteria.preferredLicense ?? null,
      requireRecentActivity: criteria.requireRecentActivity ?? false,
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
      perPage: 30,
    };
  }

  buildSearchParamsArray(criteria: SearchCriteria, filters?: { language?: string | null; license?: string | null; minStars?: number }): SearchParams[] {
    return criteria.keywords.map((keyword) => ({
      query: keyword,
      language: filters?.language ?? undefined,
      minStars: filters?.minStars ?? criteria.minStars,
      license: filters?.license ?? criteria.preferredLicense ?? undefined,
      sort: 'stars',
      order: 'desc',
      perPage: 30,
    }));
  }

  async generateMatchExplanation(repoName: string, repoDescription: string | null, userRequest: string): Promise<string> {
    const prompt = `A user searched for repositories and received this result. Explain in 1-2 sentences why this repository matches the user's request. Be specific and concise.

User request: "${userRequest}"

Repository: ${repoName}
Description: ${repoDescription ?? 'No description available'}

Explanation:`;

    const raw = await this.ollama.generate(prompt, this.model);
    return raw.trim();
  }

  async refineCriteria(
    originalCriteria: SearchCriteria,
    refinementText: string,
    originalRequest: string,
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

    const raw = await this.ollama.generate(prompt, this.model);
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
    return this.ollama.generate(prompt, model);
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
