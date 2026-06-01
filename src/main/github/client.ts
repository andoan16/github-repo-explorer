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

/** Cache READMEs per repo ID so they survive across searches. 30-min TTL. */
interface CachedReadme {
  text: string | null;
  timestamp: number;
}

export interface ReadmeCacheMetrics {
  hits: number;
  misses: number;
  size: number;
}

const README_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_README_BYTES = 8000;

/** Retry transient GitHub API 5xx errors with exponential backoff. */
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status < 500 || attempt === maxRetries) return res;
    // Exponential backoff: 500ms, 1s
    // Respect abort signal during backoff delay
    const delay = 500 * Math.pow(2, attempt);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      if (init.signal) {
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      }
    });
  }
  // Unreachable, but satisfies TypeScript
  throw new Error('Retry loop exited unexpectedly');
}

export class GitHubClient {
  private readonly baseUrl = 'https://api.github.com';

  // STATIC readme cache — shared across all GitHubClient instances so that
  // new instances (created by getGitHubClient()) don't lose cached READMEs.
  // This prevents duplicate API calls when Phase 1 + Phase 2 each create a client.
  private static readmeCache = new Map<number, CachedReadme>();
  private static readmeHits = 0;
  private static readmeMisses = 0;

  constructor(private token: string) {}

  private requestInit(overrides?: { signal?: AbortSignal }): RequestInit {
    return {
      headers: this.headers(),
      signal: overrides?.signal,
    };
  }

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
      const res = await fetch(`${this.baseUrl}/user`, this.requestInit());
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

  async searchRepos(params: SearchParams, signal?: AbortSignal): Promise<{ repos: GitHubRepo[]; totalCount: number; rateLimitRemaining: number }> {
    const qParts: string[] = [params.query];
    if (params.language) qParts.push(`language:${params.language}`);
    if (params.minStars) qParts.push(`stars:>=${params.minStars}`);
    if (params.license) qParts.push(`license:${params.license}`);

    const q = qParts.join(' ');
    let url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(q)}&sort=${params.sort}&order=${params.order}&per_page=${params.perPage}`;
    if (params.page !== undefined && params.page > 1) {
      url += `&page=${params.page}`;
    }

    // Retry on 5xx transient failures (GitHub LB 502/503)
    const res = await fetchWithRetry(url, this.requestInit({ signal }));
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

  async getReadme(owner: string, repo: string, defaultBranch: string, repoId?: number, signal?: AbortSignal): Promise<string | null> {
    // Check shared static cache first (survives across searches and client instances)
    if (repoId !== undefined) {
      const cached = GitHubClient.readmeCache.get(repoId);
      if (cached && Date.now() - cached.timestamp < README_CACHE_TTL_MS) {
        GitHubClient.readmeHits++;
        return cached.text;
      }
    }

    try {
      const url = `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
      const opts: RequestInit = {
        headers: this.headers(),
        signal,
      };
      (opts.headers as Record<string, string>)['Accept'] = 'application/vnd.github.raw+json';
      const res = await fetchWithRetry(url, opts);
      if (!res.ok) {
        // Cache negative result too (null) so we don't retry 404s
        if (repoId !== undefined) {
          GitHubClient.readmeCache.set(repoId, { text: null, timestamp: Date.now() });
        }
        GitHubClient.readmeMisses++;
        return null;
      }

      // Check Content-Length to skip excessively large READMEs before downloading
      const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
      if (contentLength > MAX_README_BYTES * 3) {
        // README is huge — read only the portion we need
        const reader = res.body?.getReader();
        if (reader) {
          let chunks = '';
          let bytesRead = 0;
          while (bytesRead < MAX_README_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = new TextDecoder().decode(value, { stream: true });
            chunks += chunk;
            bytesRead += chunk.length;
          }
          reader.cancel().catch(() => {});
          const result = chunks.length > MAX_README_BYTES
            ? chunks.slice(0, MAX_README_BYTES) + '\n\n... (truncated)'
            : chunks;
          if (repoId !== undefined) {
            GitHubClient.readmeCache.set(repoId, { text: result, timestamp: Date.now() });
          }
          return result;
        }
      }

      const text = await res.text();
      const result = text.length > MAX_README_BYTES ? text.slice(0, MAX_README_BYTES) + '\n\n... (truncated)' : text;

      if (repoId !== undefined) {
        GitHubClient.readmeCache.set(repoId, { text: result, timestamp: Date.now() });
      }
      GitHubClient.readmeMisses++;
      return result;
    } catch {
      GitHubClient.readmeMisses++;
      return null;
    }
  }

  /** Return README cache performance metrics. */
  getReadmeCacheMetrics(): ReadmeCacheMetrics {
    return {
      hits: GitHubClient.readmeHits,
      misses: GitHubClient.readmeMisses,
      size: GitHubClient.readmeCache.size,
    };
  }
}
