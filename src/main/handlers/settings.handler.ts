import { ipcMain } from 'electron';
import { IPC, type AppSettings } from '../../shared/types';
import { SettingsStore } from '../settings/store';
import { GitHubClient } from '../github/client';
import { llmManager } from '../llm/manager';

export function isValidHttpUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerSettingsHandlers(settings: SettingsStore): void {
  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    try {
      const cfg = settings.load();
      return { ok: true, data: cfg };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, newSettings: Partial<AppSettings>) => {
    try {
      if (!newSettings || typeof newSettings !== 'object') {
        return { ok: false, error: 'Invalid settings payload' };
      }
      if (newSettings.ollamaBaseUrl && !isValidHttpUrl(newSettings.ollamaBaseUrl)) {
        return { ok: false, error: 'Invalid ollamaBaseUrl: must be a valid http or https URL' };
      }
      if (newSettings.embeddedModel) {
        await llmManager.getEmbeddedEngine().setModel(newSettings.embeddedModel).catch(() => {});
      }
      settings.save(newSettings as AppSettings);
      return { ok: true };
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
}
