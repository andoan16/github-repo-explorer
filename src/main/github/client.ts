import type { GitHubRepo, SearchParams } from '../../shared/types';

interface GitHubRawRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { key: string; name: string } | null;
  updated_at: string;
  topics: string[];
  open_issues_count: number;
  default_branch: string;
  archived: boolean;
}

export class GitHubClient {
  private readonly baseUrl = 'https://api.github.com';

  constructor(private token: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'repo-explorer-app',
    };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  async checkToken(): Promise<{ valid: boolean; user?: string; error?: string }> {
    if (!this.token) return { valid: false, error: 'No token configured' };
    try {
      const res = await fetch(`${this.baseUrl}/user`, { headers: this.headers() });
      if (res.status === 401) return { valid: false, error: 'Invalid or expired token' };
      if (res.status === 403) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        return { valid: false, error: body.message ?? 'Rate-limited or forbidden' };
      }
      if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
      const user = (await res.json()) as { login: string };
      return { valid: true, user: user.login };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async searchRepos(params: SearchParams): Promise<{ repos: GitHubRepo[]; totalCount: number; rateLimitRemaining: number }> {
    const qParts: string[] = [params.query];
    if (params.language) qParts.push(`language:${params.language}`);
    if (params.minStars) qParts.push(`stars:>=${params.minStars}`);
    if (params.license) qParts.push(`license:${params.license}`);

    const q = qParts.join(' ');
    const url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(q)}&sort=${params.sort}&order=${params.order}&per_page=${params.perPage}`;

    const res = await fetch(url, { headers: this.headers() });
    const rateLimitRemaining = parseInt(res.headers.get('x-ratelimit-remaining') ?? '0', 10);

    if (res.status === 403) {
      const resetEpoch = res.headers.get('x-ratelimit-reset');
      const resetDate = resetEpoch ? new Date(parseInt(resetEpoch, 10) * 1000).toLocaleTimeString() : 'unknown';
      throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}. Add a token for higher limits.`);
    }
    if (res.status === 422) {
      throw new Error('GitHub could not parse the search query. Try a different description.');
    }
    if (!res.ok) {
      throw new Error(`GitHub search failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { items: GitHubRawRepo[]; total_count: number };

    const repos = (data.items ?? []).map((item) => ({
      id: item.id,
      full_name: item.full_name,
      html_url: item.html_url,
      description: item.description,
      stars: item.stargazers_count,
      forks: item.forks_count,
      language: item.language ?? null,
      license: item.license ? { key: item.license.key ?? '', name: item.license.name ?? '' } : null,
      updated_at: item.updated_at ?? '',
      topics: item.topics ?? [],
      open_issues: item.open_issues_count,
      default_branch: item.default_branch ?? 'main',
      archived: item.archived ?? false,
    }));

    return { repos, totalCount: data.total_count, rateLimitRemaining };
  }

  async getReadme(owner: string, repo: string, defaultBranch: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
      const res = await fetch(url, {
        headers: {
          ...this.headers(),
          'Accept': 'application/vnd.github.raw+json',
        },
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > 8000 ? text.slice(0, 8000) + '\n\n... (truncated)' : text;
    } catch {
      return null;
    }
  }
}
