import { describe, it, expect } from 'vitest';
import { QueryGenerator } from '../../src/main/search/query-gen';
import { createMockOllamaClient, createDisconnectedOllamaClient } from '../mocks/ollama';
import type { SearchParams } from '../../src/shared/types';

const USE_LIVE = process.env.RUN_INTEGRATION_TESTS === 'true' && process.env.OLLAMA_TEST_URL;

describe('QueryGenerator (integration)', () => {
  it('extracts criteria from natural language', async () => {
    const mock = createMockOllamaClient();
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'llama3.2');

    const criteria = await qg.extractCriteria('I need a self-hosted CI/CD tool with Docker support');
    expect(criteria.keywords.join(' ')).toContain('CI/CD');
    expect(criteria.technologies).toContain('Docker');
    expect(criteria.intent).toBe('devops-tool');
    expect(criteria.minStars).toBe(50);
    expect(criteria.preferredLicense).toBe('mit');
  });

  it('handles malformed LLM output gracefully', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce('some garbage text that is not json');
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    await expect(qg.extractCriteria('test request')).rejects.toThrow();
  });

  it('handles JSON wrapped in markdown fences', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce('```json\n{"keywords":["test"],"technologies":["Go"],"intent":"other","useCase":"testing","minStars":0,"preferredLicense":null,"requireRecentActivity":false}\n```');
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    const criteria = await qg.extractCriteria('test request for a thing');
    expect(criteria.keywords).toHaveLength(3);
    expect(criteria.keywords[0]).toBe('test');
    expect(criteria.technologies).toEqual(['Go']);
  });

  it('builds search params from criteria', () => {
    const mock = createMockOllamaClient();
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    const params = qg.buildSearchParams({
      keywords: ['docker', 'ci-cd', 'pipeline'],
      technologies: ['Go', 'Docker'],
      intent: 'devops-tool',
      useCase: 'CI/CD',
      minStars: 20,
      preferredLicense: 'mit',
      requireRecentActivity: true,
    });

    expect(params.query).toContain('docker');
    expect(params.query).toContain('ci-cd');
    expect(params.sort).toBe('stars');
    expect(params.order).toBe('desc');
    expect(params.perPage).toBe(30);
  });

  it('applies filter overrides to search params', () => {
    const mock = createMockOllamaClient();
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    const params = qg.buildSearchParams(
      { keywords: ['test'], technologies: [], intent: 'other', useCase: 'test', minStars: 10, preferredLicense: null, requireRecentActivity: false },
      { language: 'typescript', license: 'apache-2.0', minStars: 100 },
    );

    expect(params.language).toBe('typescript');
    expect(params.license).toBe('apache-2.0');
    expect(params.minStars).toBe(100);
  });

  it('generates match explanations', async () => {
    const mock = createMockOllamaClient();
    mock.generate.mockResolvedValueOnce('This repository matches because it is a self-hosted CI/CD platform with Docker integration.');
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    const explanation = await qg.generateMatchExplanation('org/ci-tool', 'Docker-native CI/CD', 'I need CI/CD with Docker');
    expect(explanation).toBeTruthy();
  });

  it('builds search params array with multiple queries', () => {
    const mock = createMockOllamaClient();
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    const paramsArray = qg.buildSearchParamsArray({
      keywords: ['docker', 'ci-cd', 'pipeline'],
      technologies: ['Go', 'Docker'],
      intent: 'devops-tool',
      useCase: 'CI/CD',
      minStars: 20,
      preferredLicense: 'mit',
      requireRecentActivity: true,
    });

    expect(paramsArray).toHaveLength(3);
    expect(paramsArray[0].query).toBe('docker');
    expect(paramsArray[1].query).toBe('ci-cd');
    expect(paramsArray[2].query).toBe('pipeline');
    expect(paramsArray[0].perPage).toBe(30);
  });

  it('handles Ollama being unavailable during query generation', async () => {
    const mock = createDisconnectedOllamaClient();
    const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test');

    await expect(qg.extractCriteria('test')).rejects.toThrow();
  });

  it('live test: extracts real criteria', async () => {
    if (!USE_LIVE) return;
    const { OllamaClient: RealOllama } = await import('../../src/main/ollama/client');

    const ollama = new RealOllama(process.env.OLLAMA_TEST_URL!);
    const models = await ollama.listModels();
    const model = models[0]?.name ?? 'llama3.2';

    const qg = new QueryGenerator(ollama, model);
    const criteria = await qg.extractCriteria('I want a React UI component library with dark mode support');

    expect(criteria.keywords.length).toBeGreaterThan(0);
    expect(criteria.technologies).toContain('React');
    expect(criteria.intent).toBeTruthy();
  }, 60000);
});
