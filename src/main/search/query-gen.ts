import type { SearchCriteria, SearchParams } from '../../shared/types';
import type { OllamaClient } from '../ollama/client';

export class QueryGenerator {
  constructor(private ollama: OllamaClient, private model: string) {}

  async extractCriteria(userDescription: string): Promise<SearchCriteria> {
    const prompt = `You are a GitHub search expert. Convert this user request into search criteria for the GitHub API.

User request: "${userDescription}"

Return ONLY valid JSON — no markdown, no code fences, no commentary:

{
  "searchQuery": "2-4 essential keywords in priority order — the GitHub search will AND them, so keep it focused",
  "technologies": ["languages or frameworks mentioned or implied"],
  "intent": "web-app | cli-tool | library | api | mobile-app | desktop-app | devops-tool | ai-ml-tool | database | networking-tool | security-tool | other",
  "minStars": number (0-5000, default 0),
  "preferredLicense": "mit" | "apache-2.0" | "gpl-3.0" | "bsd-3-clause" | "mpl-2.0" | null,
  "requireRecentActivity": boolean
}

JSON:`;


    const raw = await this.ollama.generate(prompt, this.model);
    const criteria = this.parseJson<{
      searchQuery?: string;
      keywords?: string[];
      technologies?: string[];
      intent?: string;
      minStars?: number;
      preferredLicense?: string | null;
      requireRecentActivity?: boolean;
    }>(raw);

    // Build the actual search query: prefer LLM-generated query, fall back to original request
    const llmQuery = criteria.searchQuery ?? '';
    const keywordFallback = (criteria.keywords ?? []).slice(0, 3).join(' ');

    return {
      keywords: llmQuery ? [llmQuery] : (keywordFallback ? [keywordFallback] : [userDescription]),
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

  async generateMatchExplanation(repoName: string, repoDescription: string | null, userRequest: string): Promise<string> {
    const prompt = `A user searched for repositories and received this result. Explain in 1-2 sentences why this repository matches the user's request. Be specific and concise.

User request: "${userRequest}"

Repository: ${repoName}
Description: ${repoDescription ?? 'No description available'}

Explanation:`;

    const raw = await this.ollama.generate(prompt, this.model);
    return raw.trim();
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
