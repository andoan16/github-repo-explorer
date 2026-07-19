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
const MAX_README_CACHE_SIZE = 200; // LRU eviction when exceeding this size
const MAX_README_BYTES = 8000;

/** Retry transient GitHub API errors (5xx + 429 rate limit) with exponential backoff.
 *  For 429 (rate limit), respects the x-ratelimit-reset header to wait until
 *  the quota resets — but only if the wait is short (< 30s) to avoid hanging
 *  the UI. Longer waits are surfaced as errors so the user knows to add a token. */
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);

    // 429 rate limit: check if we can wait and retry
    if (res.status === 429 && attempt < maxRetries) {
      const resetEpoch = res.headers.get('x-ratelimit-reset');
      if (resetEpoch) {
        const waitMs = parseInt(resetEpoch, 10) * 1000 - Date.now();
        // Only auto-wait if reset is within 15s — longer waits should surface
        // as an error so the user isn't stuck with a spinning loader
        if (waitMs > 0 && waitMs <= 15000) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, waitMs);
            if (init.signal) {
              init.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              }, { once: true });
            }
          });
          continue; // retry after waiting
        }
      }
      return res; // can't auto-wait, surface the 429 to caller
    }

    // 5xx: retry with exponential backoff
    if (res.status < 500 || attempt === maxRetries) return res;
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

  /** Set a readme cache entry, evicting expired/LRU entries if at capacity. */
  private static setReadmeCache(repoId: number, text: string | null): void {
    // Evict expired entries first, then LRU, when at capacity
    if (GitHubClient.readmeCache.size >= MAX_README_CACHE_SIZE) {
      let evicted = false;
      for (const [k, v] of GitHubClient.readmeCache) {
        if (Date.now() - v.timestamp > README_CACHE_TTL_MS) {
          GitHubClient.readmeCache.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        // LRU: delete oldest entry (first in Map insertion order)
        const oldest = GitHubClient.readmeCache.keys().next().value;
        if (oldest !== undefined) GitHubClient.readmeCache.delete(oldest);
      }
    }
    GitHubClient.readmeCache.set(repoId, { text, timestamp: Date.now() });
  }

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
    // NOTE: minStars is NOT sent to GitHub API as a query qualifier.
    // High star thresholds (e.g. stars:>=30000) combined with keyword queries
    // can return 0 results because GitHub requires ALL terms to match.
    // Instead, minStars is applied as a post-filter in ipc-handlers.ts,
    // which preserves result quality while still honoring the star filter.
    if (params.license) qParts.push(`license:${params.license}`);

    const q = qParts.join(' ');
    let url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(q)}&sort=${params.sort}&order=${params.order}&per_page=${params.perPage}`;
    if (params.page !== undefined && params.page > 1) {
      url += `&page=${params.page}`;
    }

    // Retry on 5xx transient failures (GitHub LB 502/503)
    const res = await fetchWithRetry(url, this.requestInit({ signal }));
    const rateLimitRemaining = parseInt(res.headers.get('x-ratelimit-remaining') ?? '0', 10);

    if (res.status === 403 || res.status === 429) {
      const resetEpoch = res.headers.get('x-ratelimit-reset');
      const resetMs = resetEpoch ? parseInt(resetEpoch, 10) * 1000 - Date.now() : 0;
      const resetDate = resetEpoch ? new Date(parseInt(resetEpoch, 10) * 1000).toLocaleTimeString() : 'unknown';
      const waitSec = Math.max(0, Math.ceil(resetMs / 1000));
      throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}${waitSec > 0 ? ` (in ~${waitSec}s)` : ''}. Add a GitHub token in settings for 30x higher limits (5000 req/hour vs 60 req/hour unauthenticated).`);
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
      // Expired entry — evict to keep cache size bounded
      if (cached) {
        GitHubClient.readmeCache.delete(repoId);
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
          GitHubClient.setReadmeCache(repoId, null);
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
            GitHubClient.setReadmeCache(repoId, result);
          }
          return result;
        }
      }

      const text = await res.text();
      const result = text.length > MAX_README_BYTES ? text.slice(0, MAX_README_BYTES) + '\n\n... (truncated)' : text;

      if (repoId !== undefined) {
        GitHubClient.setReadmeCache(repoId, result);
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
