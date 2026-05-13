import { ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import { OllamaClient } from './ollama/client';
import { GitHubClient } from './github/client';
import { QueryGenerator } from './search/query-gen';
import { RankingEngine } from './ranking/engine';
import { SettingsStore } from './settings/store';
import { BookmarkStore } from './bookmarks/store';
import { IPC, type GitHubRepo, type GitHubSearchResult, type SearchCriteria } from '../shared/types';

const settings = new SettingsStore();
const bookmarks = new BookmarkStore();
const rankingEngine = new RankingEngine();

interface CachedSearch {
  repos: GitHubRepo[];
  readmes: Map<number, string | null>;
  originalCriteria: SearchCriteria;
  originalRequest: string;
}

let lastSearchCache: CachedSearch | null = null;
let searchGeneration = 0;

function getOllamaClient() {
  const cfg = settings.load();
  return new OllamaClient(cfg.ollamaBaseUrl);
}

function getGitHubClient() {
  const cfg = settings.load();
  return new GitHubClient(cfg.githubToken);
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    try {
      const cfg = settings.load();
      return { ok: true, data: cfg };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, newSettings) => {
    try {
      settings.save(newSettings);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.OLLAMA_CHECK, async (_event, baseUrl?: string) => {
    try {
      const client = baseUrl ? new OllamaClient(baseUrl) : getOllamaClient();
      const status = await client.checkConnection();
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.OLLAMA_MODELS, async () => {
    try {
      const models = await getOllamaClient().listModels();
      return { ok: true, data: models };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.GITHUB_CHECK, async (_event, token?: string) => {
    try {
      const t = token ?? settings.load().githubToken;
      const client = new GitHubClient(t);
      const result = await client.checkToken();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.SEARCH, async (_event, userRequest: string, filters?: { language?: string | null; license?: string | null; minStars?: number }) => {
    const gen = ++searchGeneration;
    try {
      const cfg = settings.load();
      const ollama = getOllamaClient();
      const github = getGitHubClient();
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);

      let criteria;
      try {
        criteria = await qg.extractCriteria(userRequest);
      } catch (llmErr) {
        if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
        const message = llmErr instanceof Error ? llmErr.message : String(llmErr);
        return {
          ok: false,
          error: `Ollama query analysis failed: ${message}. Make sure Ollama is running and the model "${cfg.ollamaModel}" is pulled (run: ollama pull ${cfg.ollamaModel}).`,
        };
      }

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const allParams = qg.buildSearchParamsArray(criteria, filters);

      const searchResults = await Promise.allSettled(
        allParams.map((params) => github.searchRepos(params)),
      );

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const failedQueries = searchResults.filter((r) => r.status === 'rejected').length;
      const successfulResults = searchResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof github.searchRepos>>> => r.status === 'fulfilled')
        .map((r) => r.value);

      if (successfulResults.length === 0) {
        const firstError = (searchResults[0] as PromiseRejectedResult).reason;
        const message = firstError instanceof Error ? firstError.message : String(firstError);
        return { ok: false, error: `GitHub search failed: ${message}` };
      }

      // Merge and deduplicate by repo ID (keep higher stars on collision)
      const repoMap = new Map<number, GitHubRepo>();
      let totalCount = 0;
      for (const result of successfulResults) {
        totalCount += result.totalCount;
        for (const repo of result.repos) {
          const existing = repoMap.get(repo.id);
          if (!existing || repo.stars > existing.stars) {
            repoMap.set(repo.id, repo);
          }
        }
      }
      const repos = [...repoMap.values()];

      if (repos.length === 0) {
        return {
          ok: true,
          data: {
            results: [],
            totalSearched: 0,
            queryUsed: criteria.keywords.join(' | '),
            note: 'No repositories matched. Try broadening your description or reducing filter constraints.',
          },
        };
      }

      const preRanked = repos
        .filter((r) => !r.archived)
        .sort((a, b) => b.stars - a.stars)
        .slice(0, 12);

      const readmes = new Map<number, string | null>();
      await Promise.all(
        preRanked.map(async (repo) => {
          try {
            const [owner, name] = repo.full_name.split('/');
            const readme = await github.getReadme(owner, name, repo.default_branch);
            readmes.set(repo.id, readme);
          } catch {
            readmes.set(repo.id, null);
          }
        }),
      );

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const ranked = rankingEngine.rank(repos, criteria, readmes, userRequest, cfg.maxResults);

      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: readmes.get(repo.id) ?? null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match`,
        requestContext: userRequest,
      }));

      const note = failedQueries > 0
        ? `${failedQueries}/${allParams.length} search queries failed; showing results from ${successfulResults.length} queries.`
        : undefined;

      lastSearchCache = { repos, readmes, originalCriteria: criteria, originalRequest: userRequest };

      return { ok: true, data: { results, totalSearched: repos.length, note } };
    } catch (err) {
      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Refinement ──
  ipcMain.handle(IPC.SEARCH_REFINE, async (_event, refinementText: string) => {
    const gen = ++searchGeneration;
    try {
      if (!lastSearchCache) {
        return { ok: false, error: 'No search to refine. Run a search first.' };
      }

      const cfg = settings.load();
      const ollama = getOllamaClient();
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);

      let refinedCriteria: SearchCriteria;
      try {
        refinedCriteria = await qg.refineCriteria(
          lastSearchCache.originalCriteria,
          refinementText,
          lastSearchCache.originalRequest,
        );
      } catch (llmErr) {
        if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
        const message = llmErr instanceof Error ? llmErr.message : String(llmErr);
        return { ok: false, error: `Refinement analysis failed: ${message}` };
      }

      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };

      const ranked = rankingEngine.rank(
        lastSearchCache.repos,
        refinedCriteria,
        lastSearchCache.readmes,
        lastSearchCache.originalRequest,
        cfg.maxResults,
        refinedCriteria.weightEmphasis,
      );

      const refinedContext = `${lastSearchCache.originalRequest} (refined: ${refinementText})`;
      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: lastSearchCache!.readmes.get(repo.id) ?? null,
        score,
        matchExplanation: `Score: ${Math.round(score.total * 100)}% match (refined)`,
        requestContext: refinedContext,
      }));

      return {
        ok: true,
        data: {
          results,
          totalSearched: lastSearchCache.repos.length,
          note: `Re-ranked with refinement: "${refinementText}"`,
        },
      };
    } catch (err) {
      if (searchGeneration !== gen) return { ok: false, error: 'Search superseded' };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Explanation (lazy-loaded) ──
  ipcMain.handle(IPC.GENERATE_EXPLANATION, async (_event, params: { repoName: string; repoDescription: string | null; requestContext: string }) => {
    try {
      const cfg = settings.load();
      const ollama = getOllamaClient();
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);
      const explanation = await qg.generateMatchExplanation(
        params.repoName,
        params.repoDescription,
        params.requestContext,
      );
      return { ok: true, data: { explanation } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Bookmarks ──
  ipcMain.handle(IPC.BOOKMARKS_GET_ALL, async () => {
    try {
      return { ok: true, data: bookmarks.getAll() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BOOKMARKS_ADD, async (_event, bookmark) => {
    try {
      const all = bookmarks.add(bookmark);
      return { ok: true, data: all };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.BOOKMARKS_REMOVE, async (_event, repoId: number) => {
    try {
      const all = bookmarks.remove(repoId);
      return { ok: true, data: all };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Clone ──
  ipcMain.handle(IPC.CLONE_REPO, async (_event, repoUrl: string, repoName: string) => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Choose Clone Destination',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Clone Here',
      });

      if (canceled || filePaths.length === 0) {
        return { ok: true, data: { canceled: true } };
      }

      const targetDir = filePaths[0];

      return new Promise((resolve) => {
        const proc = spawn('git', ['clone', repoUrl, repoName], {
          cwd: targetDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ ok: true, data: { canceled: false, success: true, path: `${targetDir}\\${repoName}` } });
          } else {
            // git clone writes progress to stderr, so check if it actually cloned
            if (stderr.includes('Receiving objects') && !stderr.includes('fatal:')) {
              resolve({ ok: true, data: { canceled: false, success: true, path: `${targetDir}\\${repoName}` } });
            } else {
              resolve({ ok: false, error: `Clone failed: ${stderr.slice(-200)}` });
            }
          }
        });

        proc.on('error', (err) => {
          resolve({ ok: false, error: `Failed to start git: ${err.message}. Is git installed?` });
        });
      });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

}
