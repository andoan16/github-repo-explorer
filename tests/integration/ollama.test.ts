import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaClient } from '../../src/main/ollama/client';
import { createMockOllamaClient, createDisconnectedOllamaClient, mockModels } from '../mocks/ollama';

const USE_LIVE = process.env.RUN_INTEGRATION_TESTS === 'true' && process.env.OLLAMA_TEST_URL;

describe('OllamaClient (integration)', () => {
  let client: OllamaClient;

  beforeAll(() => {
    client = new OllamaClient(USE_LIVE ? process.env.OLLAMA_TEST_URL! : 'http://localhost:11434');
  });

  it('detects connected Ollama server', async () => {
    if (USE_LIVE) {
      const status = await client.checkConnection();
      expect(status.connected).toBe(true);
      expect(status.models.length).toBeGreaterThan(0);
    } else {
      const mock = createMockOllamaClient();
      const status = await mock.checkConnection();
      expect(status.connected).toBe(true);
      expect(status.models).toEqual(mockModels);
    }
  });

  it('detects disconnected Ollama server', async () => {
    const mock = createDisconnectedOllamaClient();
    const status = await mock.checkConnection();
    expect(status.connected).toBe(false);
    expect(status.error).toContain('not running');
  });

  it('lists available models', async () => {
    if (USE_LIVE) {
      const models = await client.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('name');
    } else {
      const mock = createMockOllamaClient();
      const models = await mock.listModels();
      expect(models).toEqual(mockModels);
    }
  });

  it('generates completions', async () => {
    if (USE_LIVE) {
      const response = await client.generate('Say "hello world" and nothing else.', 'llama3.2');
      expect(response.toLowerCase()).toContain('hello');
    } else {
      const mock = createMockOllamaClient();
      const response = await mock.generate('test prompt');
      expect(response).toContain('CI/CD');
    }
  });

  it('throws on invalid model', async () => {
    if (USE_LIVE) {
      const badClient = new OllamaClient(process.env.OLLAMA_TEST_URL ?? 'http://localhost:11434');
      await expect(badClient.generate('test', 'nonexistent-model-xyz-999')).rejects.toThrow();
    }
  });
});
