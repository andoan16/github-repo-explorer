import { EventEmitter } from 'events';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { app } from 'electron';
import {
  EMBEDDED_MODELS,
  type EmbeddedModelId,
  type EmbeddedModelOption,
  type EmbeddedModelStatus,
} from '../../shared/types';
import type { ILlmClient } from './types';
import { getSystemSpecs } from './system-specs';

export const DEFAULT_MODEL_ID: EmbeddedModelId = 'qwen2.5-0.5b';
export const DEFAULT_MODEL_URL = EMBEDDED_MODELS[DEFAULT_MODEL_ID].url;
export const DEFAULT_MODEL_FILENAME = EMBEDDED_MODELS[DEFAULT_MODEL_ID].filename;
export const DEFAULT_MODEL_DISPLAY_NAME = EMBEDDED_MODELS[DEFAULT_MODEL_ID].name;

export class EmbeddedLlmEngine extends EventEmitter implements ILlmClient {
  private status: EmbeddedModelStatus;
  private currentModelId: EmbeddedModelId;
  private modelFilePath: string;
  private modelsDir: string;
  private isInitializing = false;
  private isDownloading = false;
  private llamaInstance: any = null;
  private modelInstance: any = null;
  private contextInstance: any = null;
  private chatSession: any = null;
  private embeddingContext: any = null;
  private customModelsDir?: string;

  constructor(customModelsDir?: string, initialModelId: EmbeddedModelId = DEFAULT_MODEL_ID) {
    super();
    this.customModelsDir = customModelsDir;
    this.currentModelId = EMBEDDED_MODELS[initialModelId] ? initialModelId : DEFAULT_MODEL_ID;

    let userDir = '/tmp';
    try {
      userDir = app.getPath('userData');
    } catch {
      userDir = join(homedir(), '.repo-explorer');
    }
    this.modelsDir = customModelsDir || join(userDir, 'models');
    this.modelFilePath = this.resolveModelPath(this.currentModelId);

    const exists = this.checkFileExists(this.currentModelId);
    const modelMeta = EMBEDDED_MODELS[this.currentModelId];
    this.status = {
      status: exists ? 'ready' : 'not_downloaded',
      modelId: this.currentModelId,
      modelName: modelMeta.name,
      progress: exists ? 100 : 0,
      totalBytes: modelMeta.sizeBytes,
      downloadedBytes: exists ? modelMeta.sizeBytes : 0,
    };
  }

  /**
   * Resolves the on-disk file path for a model, checking both the app's models directory
   * and the default ~/.node-llama-cpp/models directory.
   */
  private resolveModelPath(modelId: EmbeddedModelId): string {
    const meta = EMBEDDED_MODELS[modelId] || EMBEDDED_MODELS[DEFAULT_MODEL_ID];
    const localPath = join(this.modelsDir, meta.filename);

    if (existsSync(localPath)) {
      return localPath;
    }

    if (!this.customModelsDir) {
      const cliPath = join(homedir(), '.node-llama-cpp', 'models', meta.filename);
      if (existsSync(cliPath)) {
        return cliPath;
      }
    }

    return localPath;
  }

  /**
   * Checks whether the GGUF model file is downloaded and valid (> 300MB).
   */
  public checkFileExists(modelId: EmbeddedModelId = this.currentModelId): boolean {
    try {
      const meta = EMBEDDED_MODELS[modelId] || EMBEDDED_MODELS[DEFAULT_MODEL_ID];
      const localPath = join(this.modelsDir, meta.filename);
      if (existsSync(localPath)) {
        const stats = statSync(localPath);
        if (stats.size > 300 * 1024 * 1024) return true;
      }

      if (!this.customModelsDir) {
        const cliPath = join(homedir(), '.node-llama-cpp', 'models', meta.filename);
        if (existsSync(cliPath)) {
          const stats = statSync(cliPath);
          if (stats.size > 300 * 1024 * 1024) {
            return true;
          }
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Returns a map of downloaded state for all available embedded models.
   */
  public getDownloadedModels(): Record<EmbeddedModelId, boolean> {
    const result: Record<EmbeddedModelId, boolean> = {
      'qwen2.5-0.5b': false,
      'qwen2.5-1.5b': false,
      'qwen2.5-3b': false,
    };
    for (const id of Object.keys(EMBEDDED_MODELS) as EmbeddedModelId[]) {
      result[id] = this.checkFileExists(id);
    }
    return result;
  }

  public getCurrentModelId(): EmbeddedModelId {
    return this.currentModelId;
  }

  /**
   * Switches the active embedded model.
   * If a model is currently loaded in memory, it is disposed before switching.
   */
  public async setModel(modelId: EmbeddedModelId): Promise<void> {
    const targetId = EMBEDDED_MODELS[modelId] ? modelId : DEFAULT_MODEL_ID;
    if (this.currentModelId === targetId && this.modelFilePath) {
      return;
    }

    if (this.isDownloading) {
      throw new Error('Không thể đổi model khi đang trong quá trình tải xuống.');
    }

    await this.disposeModelInstances();

    this.currentModelId = targetId;
    this.modelFilePath = this.resolveModelPath(targetId);
    const exists = this.checkFileExists(targetId);
    const meta = EMBEDDED_MODELS[targetId];

    this.updateStatus({
      status: exists ? 'ready' : 'not_downloaded',
      modelId: targetId,
      modelName: meta.name,
      progress: exists ? 100 : 0,
      totalBytes: meta.sizeBytes,
      downloadedBytes: exists ? meta.sizeBytes : 0,
      error: undefined,
    });
  }

  public getStatus(): EmbeddedModelStatus {
    return {
      ...this.status,
      modelId: this.currentModelId,
      modelName: EMBEDDED_MODELS[this.currentModelId]?.name || DEFAULT_MODEL_DISPLAY_NAME,
      downloadedModels: this.getDownloadedModels(),
      systemSpecs: getSystemSpecs(),
    };
  }

  private updateStatus(newStatus: Partial<EmbeddedModelStatus>): void {
    this.status = { ...this.status, ...newStatus };
    this.emit('status-changed', this.getStatus());
  }

  /**
   * Start downloading the embedded GGUF model if not present.
   */
  public async downloadModel(modelId?: EmbeddedModelId): Promise<void> {
    if (modelId && modelId !== this.currentModelId) {
      await this.setModel(modelId);
    }

    if (this.isDownloading) return;

    if (this.checkFileExists(this.currentModelId)) {
      this.modelFilePath = this.resolveModelPath(this.currentModelId);
      this.updateStatus({ status: 'ready', progress: 100 });
      return;
    }

    const meta = EMBEDDED_MODELS[this.currentModelId];
    this.isDownloading = true;
    this.updateStatus({
      status: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: meta.sizeBytes,
      error: undefined,
    });

    try {
      if (!existsSync(this.modelsDir)) {
        mkdirSync(this.modelsDir, { recursive: true });
      }

      const { createModelDownloader } = await import('node-llama-cpp');
      const downloader = await createModelDownloader({
        modelUrl: meta.url,
        dirPath: this.modelsDir,
        fileName: meta.filename,
        onProgress: (p: { totalSize: number; downloadedSize: number }) => {
          const total = p.totalSize || meta.sizeBytes;
          const current = p.downloadedSize || 0;
          const progress = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
          this.updateStatus({
            status: 'downloading',
            progress,
            downloadedBytes: current,
            totalBytes: total,
          });
        },
      });

      await downloader.download();

      this.isDownloading = false;
      this.modelFilePath = join(this.modelsDir, meta.filename);
      this.updateStatus({ status: 'ready', progress: 100 });
    } catch (err) {
      this.isDownloading = false;
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({
        status: 'error',
        error: `Tải model thất bại: ${message}`,
      });
      throw err;
    }
  }

  /**
   * Loads the model and context into memory for inference.
   */
  public async loadModel(): Promise<void> {
    if (this.chatSession) return;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return;
    }

    if (!this.checkFileExists(this.currentModelId)) {
      throw new Error(`Embedded model (${this.currentModelId}) chưa được tải.`);
    }

    this.modelFilePath = this.resolveModelPath(this.currentModelId);
    this.isInitializing = true;
    this.updateStatus({ status: 'loading' });

    try {
      const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
      this.llamaInstance = await getLlama();
      this.modelInstance = await this.llamaInstance.loadModel({
        modelPath: this.modelFilePath,
      });

      this.contextInstance = await this.modelInstance.createContext({
        contextSize: 2048,
      });

      this.chatSession = new LlamaChatSession({
        contextSequence: this.contextInstance.getSequence(),
      });

      this.isInitializing = false;
      this.updateStatus({ status: 'ready', progress: 100 });
    } catch (err) {
      this.isInitializing = false;
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({
        status: 'error',
        error: `Không thể tải model vào bộ nhớ: ${message}`,
      });
      throw err;
    }
  }

  /**
   * Generates a completion from prompt using the embedded llama engine.
   */
  public async generate(
    prompt: string,
    _model?: string,
    signal?: AbortSignal,
    maxTokens?: number,
  ): Promise<string> {
    if (!this.checkFileExists(this.currentModelId)) {
      this.downloadModel().catch(() => {});
      throw new Error('Embedded model is not ready (downloading or missing).');
    }

    if (!this.chatSession) {
      await this.loadModel();
    }

    // Reset history so each query/explanation is evaluated independently
    this.chatSession.resetChatHistory();

    const response = await this.chatSession.prompt(prompt, {
      maxTokens: maxTokens ?? 512,
      temperature: 0.3,
      signal,
    });

    if (!response || response.trim().length === 0) {
      throw new Error('Embedded model returned empty response');
    }

    return response;
  }

  /**
   * Generates a semantic vector embedding for the given text.
   */
  public async getEmbedding(
    text: string,
    _model?: string,
    _signal?: AbortSignal,
  ): Promise<number[]> {
    if (!this.checkFileExists(this.currentModelId)) {
      throw new Error('Embedded model is not ready (downloading or missing).');
    }

    if (!this.embeddingContext) {
      if (!this.modelInstance) {
        await this.loadModel();
      }
      this.embeddingContext = await this.modelInstance.createEmbeddingContext({
        contextSize: 1024,
      });
    }

    let safeText = text;
    const maxTokens = (this.embeddingContext._llamaContext?.contextSize ?? 1024) - 16;
    if (typeof this.embeddingContext.calculateInputLength === 'function') {
      if (this.embeddingContext.calculateInputLength(safeText) >= maxTokens) {
        if (this.modelInstance?.tokenize && this.modelInstance?.detokenize) {
          const tokens = this.modelInstance.tokenize(safeText);
          safeText = this.modelInstance.detokenize(tokens.slice(0, maxTokens - 10));
        } else {
          safeText = safeText.slice(0, 1500);
        }
      }
    } else if (safeText.length > 2000) {
      safeText = safeText.slice(0, 2000);
    }

    const result = await this.embeddingContext.getEmbeddingFor(safeText);
    if (!result?.vector || !Array.isArray(result.vector)) {
      throw new Error('Failed to generate embedding from embedded model');
    }
    return result.vector;
  }

  private async disposeModelInstances(): Promise<void> {
    try {
      if (this.chatSession) {
        this.chatSession.dispose?.();
        this.chatSession = null;
      }
      if (this.embeddingContext) {
        await this.embeddingContext.dispose?.();
        this.embeddingContext = null;
      }
      if (this.contextInstance) {
        await this.contextInstance.dispose?.();
        this.contextInstance = null;
      }
      if (this.modelInstance) {
        await this.modelInstance.dispose?.();
        this.modelInstance = null;
      }
    } catch {
      // ignore disposal errors
    }
  }

  /**
   * Clean up resources when app shuts down.
   */
  public async dispose(): Promise<void> {
    await this.disposeModelInstances();
  }
}
