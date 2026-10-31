import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddedLlmEngine } from '../../src/main/llm/embedded-llm';
import { LlmManager } from '../../src/main/llm/manager';
import { OllamaClient } from '../../src/main/ollama/client';
import type { AppSettings } from '../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/test-user-data';
      return '/tmp';
    },
  },
}));

describe('EmbeddedLlmEngine', () => {
  let engine: EmbeddedLlmEngine;

  beforeEach(() => {
    engine = new EmbeddedLlmEngine('/tmp/test-empty-models-dir');
  });

  afterEach(async () => {
    await engine.dispose();
    vi.restoreAllMocks();
  });

  it('initializes with expected model name and not_downloaded status when file does not exist', () => {
    const status = engine.getStatus();
    expect(status.modelName).toContain('Qwen2.5-0.5B-Instruct');
    expect(status.status).toBe('not_downloaded');
  });

  it('throws an error on generate if model is not downloaded yet', async () => {
    await expect(engine.generate('hello')).rejects.toThrow(
      'Embedded model is not ready',
    );
  });

  it('emits status-changed event when updateStatus is called', () => {
    const listener = vi.fn();
    engine.on('status-changed', listener);

    // @ts-ignore - access private method for testing
    engine.updateStatus({ status: 'downloading', progress: 50 });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'downloading',
        progress: 50,
      }),
    );
  });

  it('switches between small, medium, and large models via setModel', async () => {
    expect(engine.getCurrentModelId()).toBe('qwen2.5-0.5b');

    await engine.setModel('qwen2.5-1.5b');
    expect(engine.getCurrentModelId()).toBe('qwen2.5-1.5b');
    expect(engine.getStatus().modelName).toContain('1.5B');

    await engine.setModel('qwen2.5-3b');
    expect(engine.getCurrentModelId()).toBe('qwen2.5-3b');
    expect(engine.getStatus().modelName).toContain('3B');
  });

  it('provides downloadedModels status and systemSpecs in getStatus', () => {
    const status = engine.getStatus();
    expect(status.downloadedModels).toBeDefined();
    expect('qwen2.5-0.5b' in status.downloadedModels!).toBe(true);
    expect('qwen2.5-1.5b' in status.downloadedModels!).toBe(true);
    expect('qwen2.5-3b' in status.downloadedModels!).toBe(true);

    expect(status.systemSpecs).toBeDefined();
    expect(status.systemSpecs?.totalMemoryGb).toBeGreaterThan(0);
    expect(['qwen2.5-0.5b', 'qwen2.5-1.5b', 'qwen2.5-3b']).toContain(
      status.systemSpecs?.suggestedModelId,
    );
  });
});

describe('getSystemSpecs', () => {
  it('suggests 0.5B for low RAM (< 7.5 GB)', async () => {
    const { getSystemSpecs } = await import('../../src/main/llm/system-specs');

    const specs = getSystemSpecs(4 * 1024 * 1024 * 1024);
    expect(specs.suggestedModelId).toBe('qwen2.5-0.5b');
    expect(specs.recommendationReason).toContain('0.5B');
  });

  it('suggests 1.5B for medium RAM (8 - 15 GB)', async () => {
    const { getSystemSpecs } = await import('../../src/main/llm/system-specs');

    const specs = getSystemSpecs(8 * 1024 * 1024 * 1024);
    expect(specs.suggestedModelId).toBe('qwen2.5-1.5b');
    expect(specs.recommendationReason).toContain('1.5B');
  });

  it('suggests 3B for high RAM (>= 16 GB)', async () => {
    const { getSystemSpecs } = await import('../../src/main/llm/system-specs');

    const specs = getSystemSpecs(16 * 1024 * 1024 * 1024);
    expect(specs.suggestedModelId).toBe('qwen2.5-3b');
    expect(specs.recommendationReason).toContain('3B');
  });
});

describe('LlmManager', () => {
  let manager: LlmManager;

  beforeEach(() => {
    manager = new LlmManager();
  });

  afterEach(async () => {
    await manager.dispose();
    vi.restoreAllMocks();
  });

  it('returns embedded engine when llmProvider is embedded', () => {
    const client = manager.getClient(DEFAULT_SETTINGS);
    expect(client).toBeInstanceOf(EmbeddedLlmEngine);
  });

  it('returns OllamaClient when llmProvider is ollama', () => {
    const ollamaSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      llmProvider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
    };
    const client = manager.getClient(ollamaSettings);
    expect(client).toBeInstanceOf(OllamaClient);
  });

  it('returns unified LlmStatus including embedded and ollama', async () => {
    const status = await manager.getStatus(DEFAULT_SETTINGS);
    expect(status.provider).toBe('embedded');
    expect(status.embedded).toBeDefined();
    expect(status.embedded.modelName).toContain('Qwen2.5');
    expect(status.ollama).toEqual({ connected: false, models: [] });
  });
});
