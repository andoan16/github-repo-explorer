import { describe, it, expect, vi } from 'vitest';
import { QueryGenerator } from '../../src/main/search/query-gen';

function mockOllamaWithResponse(response: string) {
  return {
    checkConnection: vi.fn(),
    listModels: vi.fn(),
    generate: vi.fn().mockResolvedValue(response),
  };
}

function createQg(response: string) {
  const mock = mockOllamaWithResponse(response);
  const qg = new QueryGenerator(mock as unknown as Parameters<typeof QueryGenerator>[0], 'test-model');
  return { qg, mock };
}

describe('QueryGenerator (unit)', () => {
  it('extracts 3 keyword queries from searchQueries array', async () => {
    const { qg } = createQg(
      '{"searchQueries":["CI CD Docker","pipeline automation","devops self hosted"],"technologies":["Docker","Go"],"intent":"devops-tool","minStars":50,"preferredLicense":"mit","requireRecentActivity":true}',
    );

    const criteria = await qg.extractCriteria('I need a self-hosted CI/CD tool');
    expect(criteria.keywords).toHaveLength(3);
    expect(criteria.keywords[0]).toContain('CI');
    expect(criteria.keywords[1]).toContain('pipeline');
    expect(criteria.keywords[2]).toContain('devops');
    expect(criteria.technologies).toContain('Docker');
    expect(criteria.intent).toBe('devops-tool');
  });

  it('handles legacy searchQuery format', async () => {
    const { qg } = createQg(
      '{"searchQuery":"CI/CD Docker self-hosted","technologies":["Docker"],"intent":"devops-tool","minStars":10,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('CI/CD tool');
    // Single searchQuery gets split into one keyword (no garbage padding)
    expect(criteria.keywords.length).toBeGreaterThanOrEqual(1);
    expect(criteria.keywords[0]).toContain('CI/CD');
  });

  it('handles legacy keywords array', async () => {
    const { qg } = createQg(
      '{"keywords":["react","ui","library"],"technologies":["TypeScript"],"intent":"library","minStars":0,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('UI component library');
    // No garbage padding — returns actual LLM keywords
    expect(criteria.keywords.length).toBeGreaterThanOrEqual(1);
    expect(criteria.keywords[0]).toContain('react');
    expect(criteria.technologies).toContain('TypeScript');
  });

  it('falls back to user description when LLM returns no valid queries', async () => {
    const { qg } = createQg(
      '{"technologies":[],"intent":"other","minStars":0,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('a self-hosted CI/CD platform');
    // No garbage padding — returns the user description as a single keyword
    expect(criteria.keywords.length).toBeGreaterThanOrEqual(1);
    expect(criteria.keywords[0]).toContain('self-hosted');
  });

  it('returns fewer good queries instead of padding with garbage', async () => {
    const { qg } = createQg(
      '{"searchQueries":["single docker query"],"technologies":["Docker"],"intent":"devops-tool","minStars":0,"preferredLicense":null,"requireRecentActivity":false}',
    );

    const criteria = await qg.extractCriteria('I need Docker stuff');
    // No longer pads to 3 with word-slice nonsense — 1 good query is better
    expect(criteria.keywords.length).toBeLessThanOrEqual(3);
    expect(criteria.keywords[0]).toBe('single docker query');
  });

  it('buildSearchParamsArray creates one SearchParams per keyword', () => {
    const { qg } = createQg('{}');

    const paramsArray = qg.buildSearchParamsArray({
      keywords: ['docker ci-cd', 'pipeline automation', 'devops tools'],
      technologies: ['Go', 'Docker'],
      intent: 'devops-tool',
      useCase: 'CI/CD tool',
      minStars: 20,
      preferredLicense: 'mit',
      requireRecentActivity: true,
    });

    expect(paramsArray).toHaveLength(3);
    expect(paramsArray[0].query).toBe('docker ci-cd');
    expect(paramsArray[1].query).toBe('pipeline automation');
    expect(paramsArray[2].query).toBe('devops tools');
    expect(paramsArray[0].sort).toBe('stars');
    expect(paramsArray[0].perPage).toBe(10);
  });

  it('buildSearchParamsArray applies filters to all params', () => {
    const { qg } = createQg('{}');

    const paramsArray = qg.buildSearchParamsArray(
      { keywords: ['query1', 'query2', 'query3'], technologies: [], intent: 'other', useCase: 'test', minStars: 5, preferredLicense: null, requireRecentActivity: false },
      { language: 'typescript', license: 'mit', minStars: 50 },
    );

    for (const p of paramsArray) {
      expect(p.language).toBe('typescript');
      expect(p.license).toBe('mit');
      expect(p.minStars).toBe(50);
    }
  });

  it('buildSearchParams remains backward compatible', () => {
    const { qg } = createQg('{}');

    const params = qg.buildSearchParams({
      keywords: ['docker', 'ci-cd', 'pipeline'],
      technologies: ['Go'],
      intent: 'devops-tool',
      useCase: 'CI/CD',
      minStars: 20,
      preferredLicense: 'mit',
      requireRecentActivity: true,
    });

    expect(params.query).toContain('docker');
    expect(params.query).toContain('ci-cd');
    expect(params.sort).toBe('stars');
  });
});
