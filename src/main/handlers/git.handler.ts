import { ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import { join } from 'path';
import { IPC } from '../../shared/types';

const SAFE_REPO_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;
const SAFE_REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function validateCloneInputs(repoUrl: unknown, repoName: unknown): { ok: true; url: string; name: string } | { ok: false; error: string } {
  if (typeof repoUrl !== 'string' || typeof repoName !== 'string') {
    return { ok: false, error: 'Invalid clone request: url and name must be strings' };
  }
  // Reject any whitespace (including newlines that could be interpreted as separate args)
  if (/\s/.test(repoUrl)) {
    return { ok: false, error: 'Invalid clone URL: must not contain whitespace' };
  }
  // Reject git argument injection: URLs or repo names starting with - or -- are treated as options by git
  if (repoUrl.startsWith('--') || repoUrl.startsWith('-')) {
    return { ok: false, error: 'Invalid clone URL: must not start with a dash or hyphen' };
  }
  if (repoName.startsWith('-')) {
    return { ok: false, error: 'Invalid repo name: must not start with a hyphen' };
  }
  if (!SAFE_REPO_URL_RE.test(repoUrl)) {
    return { ok: false, error: 'Invalid clone URL: only https://github.com/<owner>/<repo> URLs are allowed' };
  }
  if (!SAFE_REPO_NAME_RE.test(repoName)) {
    return { ok: false, error: 'Invalid repo name: only letters, digits, dots, underscores, and hyphens are allowed' };
  }
  // Prevent path traversal in repoName
  if (repoName.includes('..') || repoName.includes('/') || repoName.includes('\\')) {
    return { ok: false, error: 'Invalid repo name: must not contain path traversal sequences' };
  }
  return { ok: true, url: repoUrl, name: repoName };
}

export function registerGitHandlers(): void {
  ipcMain.handle(IPC.CLONE_REPO, async (_event, repoUrl: string, repoName: string) => {
    try {
      const validation = validateCloneInputs(repoUrl, repoName);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }
      const safeUrl = validation.url;
      const safeName = validation.name;

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
        // Use '--' end-of-options delimiter to strictly prevent CLI argument injection
        const proc = spawn('git', ['clone', '--', safeUrl, safeName], {
          cwd: targetDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ ok: true, data: { canceled: false, success: true, path: join(targetDir, safeName) } });
          } else {
            // git clone writes progress to stderr, so check if it actually cloned
            if (stderr.includes('Receiving objects') && !stderr.includes('fatal:')) {
              resolve({ ok: true, data: { canceled: false, success: true, path: join(targetDir, safeName) } });
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
