import { ipcMain, BrowserWindow } from 'electron';
import { IPC, type AppSettings } from '../../shared/types';
import { SettingsStore } from '../settings/store';
import { OllamaClient } from '../ollama/client';
import { llmManager } from '../llm/manager';
import { isValidHttpUrl } from './settings.handler';

export function registerLlmHandlers(settings: SettingsStore): void {
  const initialCfg = settings.load();
  llmManager.init(initialCfg).catch(() => {});

  llmManager.getEmbeddedEngine().on('status-changed', (embeddedStatus) => {
    const wins = BrowserWindow.getAllWindows();
    const currentCfg = settings.load();
    for (const win of wins) {
      win.webContents.send(IPC.LLM_STATUS_UPDATE, {
        provider: currentCfg.llmProvider ?? 'embedded',
        embedded: embeddedStatus,
        ollama: { connected: false, models: [] },
      });
    }
  });

  ipcMain.handle(IPC.LLM_STATUS, async () => {
    try {
      const cfg = settings.load();
      const status = await llmManager.getStatus(cfg);
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.LLM_DOWNLOAD_MODEL, async (_event, modelId?: any) => {
    try {
      await llmManager.getEmbeddedEngine().downloadModel(modelId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.OLLAMA_CHECK, async (_event, baseUrl?: string, apiKey?: string) => {
    try {
      if (baseUrl !== undefined && baseUrl !== null && baseUrl !== '') {
        if (typeof baseUrl !== 'string' || !isValidHttpUrl(baseUrl)) {
          return { ok: false, error: 'Invalid Ollama URL: must be a valid http or https URL' };
        }
      }
      const cfg = settings.load();
      const client = baseUrl
        ? new OllamaClient(baseUrl, apiKey || undefined)
        : new OllamaClient(cfg.ollamaBaseUrl, cfg.ollamaApiKey || undefined);
      const status = await client.checkConnection();
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.OLLAMA_MODELS, async () => {
    try {
      const cfg = settings.load();
      const client = new OllamaClient(cfg.ollamaBaseUrl, cfg.ollamaApiKey || undefined);
      const models = await client.listModels();
      return { ok: true, data: models };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
