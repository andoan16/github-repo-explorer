import { ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import { OllamaClient } from './ollama/client';
import { GitHubClient } from './github/client';
import { QueryGenerator } from './search/query-gen';
import { RankingEngine } from './ranking/engine';
import { SettingsStore } from './settings/store';
import { BookmarkStore } from './bookmarks/store';
import { IPC, type GitHubSearchResult } from '../shared/types';

const settings = new SettingsStore();
const bookmarks = new BookmarkStore();
const rankingEngine = new RankingEngine();

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
    try {
      const cfg = settings.load();
      const ollama = getOllamaClient();
      const github = getGitHubClient();
      const qg = new QueryGenerator(ollama, cfg.ollamaModel);

      let criteria;
      try {
        criteria = await qg.extractCriteria(userRequest);
      } catch (llmErr) {
        const message = llmErr instanceof Error ? llmErr.message : String(llmErr);
        return {
          ok: false,
          error: `Ollama query analysis failed: ${message}. Make sure Ollama is running and the model "${cfg.ollamaModel}" is pulled (run: ollama pull ${cfg.ollamaModel}).`,
        };
      }

      const params = qg.buildSearchParams(criteria, filters);

      let repos;
      let totalCount;
      try {
        const result = await github.searchRepos(params);
        repos = result.repos;
        totalCount = result.totalCount;
      } catch (ghErr) {
        const message = ghErr instanceof Error ? ghErr.message : String(ghErr);
        return { ok: false, error: `GitHub search failed: ${message}` };
      }

      if (repos.length === 0) {
        return {
          ok: true,
          data: {
            results: [],
            totalSearched: 0,
            queryUsed: params.query,
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

      const ranked = rankingEngine.rank(repos, criteria, readmes, userRequest, cfg.maxResults);

      const topN = ranked.slice(0, 8);
      const explanations = await Promise.all(
        topN.map(async ({ repo }) => {
          try {
            const explanation = await qg.generateMatchExplanation(
              repo.full_name,
              repo.description,
              userRequest,
            );
            return { id: repo.id, explanation };
          } catch {
            return { id: repo.id, explanation: `Matches search criteria: ${repo.description ?? repo.full_name}` };
          }
        }),
      );
      const explanationMap = new Map(explanations.map((e) => [e.id, e.explanation]));

      const results: GitHubSearchResult[] = ranked.map(({ repo, score }) => ({
        repo,
        readme: readmes.get(repo.id) ?? null,
        score,
        matchExplanation: explanationMap.get(repo.id) ?? `Matches based on search keywords and repository metadata.`,
      }));

      return { ok: true, data: { results, totalSearched: repos.length } };
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
