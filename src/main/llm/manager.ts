import { OllamaClient } from '../ollama/client';
import { EmbeddedLlmEngine } from './embedded-llm';
import type { AppSettings, LlmStatus, OllamaStatus } from '../../shared/types';
import type { ILlmClient } from './types';

export class LlmManager {
  private embeddedEngine: EmbeddedLlmEngine;

  constructor() {
    this.embeddedEngine = new EmbeddedLlmEngine();
  }

  public getEmbeddedEngine(): EmbeddedLlmEngine {
    return this.embeddedEngine;
  }

  public getClient(cfg: AppSettings): ILlmClient {
    if (cfg.llmProvider === 'ollama') {
      return new OllamaClient(cfg.ollamaBaseUrl, cfg.ollamaApiKey || undefined);
    }
    if (cfg.embeddedModel && this.embeddedEngine.getCurrentModelId() !== cfg.embeddedModel) {
      this.embeddedEngine.setModel(cfg.embeddedModel).catch(() => {});
    }
    return this.embeddedEngine;
  }

  public async getStatus(cfg: AppSettings): Promise<LlmStatus> {
    if (cfg.embeddedModel && this.embeddedEngine.getCurrentModelId() !== cfg.embeddedModel) {
      await this.embeddedEngine.setModel(cfg.embeddedModel).catch(() => {});
    }

    let ollamaStatus: OllamaStatus = { connected: false, models: [] };
    if (cfg.llmProvider === 'ollama') {
      try {
        const client = new OllamaClient(cfg.ollamaBaseUrl, cfg.ollamaApiKey || undefined);
        ollamaStatus = await client.checkConnection();
      } catch (err) {
        ollamaStatus = {
          connected: false,
          models: [],
        };
      }
    }

    return {
      provider: cfg.llmProvider ?? 'embedded',
      embedded: this.embeddedEngine.getStatus(),
      ollama: ollamaStatus,
    };
  }

  public async init(cfg: AppSettings): Promise<void> {
    if (cfg.llmProvider === 'embedded') {
      if (cfg.embeddedModel && this.embeddedEngine.getCurrentModelId() !== cfg.embeddedModel) {
        await this.embeddedEngine.setModel(cfg.embeddedModel).catch(() => {});
      }
      const status = this.embeddedEngine.getStatus();
      if (status.status === 'not_downloaded') {
        // Auto-download in the background
        this.embeddedEngine.downloadModel().catch((err) => {
          console.warn('[LlmManager] Background model download failed:', err);
        });
      } else if (status.status === 'ready') {
        // Pre-warm the model in the background
        this.embeddedEngine.loadModel().catch(() => {});
      }
    } else {
      // Pre-warm Ollama connection
      new OllamaClient(cfg.ollamaBaseUrl, cfg.ollamaApiKey || undefined)
        .checkConnection()
        .catch(() => {});
    }
  }

  public async dispose(): Promise<void> {
    await this.embeddedEngine.dispose();
  }
}

export const llmManager = new LlmManager();
