import { describe, it, expect } from 'vitest';
import { RankingEngine } from '../../src/main/ranking/engine';
import { makeMockRepo } from '../mocks/github';
import type { SearchCriteria } from '../../src/shared/types';

const engine = new RankingEngine();

const criteria: SearchCriteria = {
  keywords: ['CI/CD', 'docker', 'self-hosted', 'pipeline'],
  technologies: ['Go', 'Docker', 'TypeScript'],
  intent: 'devops-tool',
  useCase: 'Self-hosted CI/CD platform',
  minStars: 10,
  preferredLicense: 'mit',
  requireRecentActivity: true,
};

describe('RankingEngine', () => {
  it('scores a high-match repo above 0.7', () => {
    const repo = makeMockRepo({
      full_name: 'harness/gitness',
      description: 'Self-hosted CI/CD platform with Docker support',
      stars: 30000,
      language: 'Go',
      license: { key: 'mit', name: 'MIT' },
      topics: ['ci-cd', 'docker', 'devops', 'kubernetes'],
      updated_at: new Date().toISOString(),
    });

    const readme = 'Open source CI/CD platform. Docker-native. Self-hosted pipeline automation.';
    const score = engine.scoreRepo(repo, criteria, readme, 'CI/CD platform');

    expect(score.total).toBeGreaterThan(0.7);
    expect(score.semanticMatch).toBeGreaterThan(0.5);
    expect(score.languageMatch).toBeGreaterThan(0.5);
    expect(score.licenseCompatibility).toBeGreaterThan(0.8);
  });

  it('scores a low-match repo below 0.4', () => {
    const repo = makeMockRepo({
      full_name: 'someone/game-engine',
      description: 'A 2D game engine written in Rust',
      stars: 50,
      language: 'Rust',
      license: { key: 'gpl-3.0', name: 'GPL 3.0' },
      topics: ['gamedev', 'graphics'],
      updated_at: '2020-01-01T00:00:00Z',
    });

    const score = engine.scoreRepo(repo, criteria, null, 'CI/CD platform');
    expect(score.total).toBeLessThan(0.4);
  });

  it('ranks repositories in descending order', async () => {
    const repos = [
      makeMockRepo({ id: 1, full_name: 'a/low', stars: 5, description: 'Unrelated game', language: 'Lua', updated_at: '2019-01-01T00:00:00Z' }),
      makeMockRepo({ id: 2, full_name: 'b/high', stars: 25000, description: 'Self-hosted CI/CD with Docker', language: 'Go', updated_at: new Date().toISOString() }),
      makeMockRepo({ id: 3, full_name: 'c/mid', stars: 1000, description: 'CI helper tool', language: 'Python', updated_at: '2025-01-01T00:00:00Z' }),
    ];

    const readmes = new Map<number, string | null>();
    readmes.set(2, 'Docker CI/CD platform. Self-hosted pipeline automation.');

    const ranked = await engine.rank(repos, criteria, readmes, 'CI/CD tool', 10);
    expect(ranked[0].repo.id).toBe(2);
    expect(ranked[0].score.total).toBeGreaterThan(ranked[1].score.total);
    expect(ranked[1].score.total).toBeGreaterThan(ranked[2].score.total);
  });

  it('filters out archived repos', async () => {
    const repos = [
      makeMockRepo({ id: 1, archived: true, full_name: 'a/archived' }),
      makeMockRepo({ id: 2, full_name: 'b/active' }),
    ];

    const ranked = await engine.rank(repos, criteria, new Map(), 'test', 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].repo.id).toBe(2);
  });

  it('respects maxResults limit', async () => {
    const repos = Array.from({ length: 20 }, (_, i) =>
      makeMockRepo({ id: i + 1, full_name: `org/repo-${i}`, stars: 1000 - i * 50 }),
    );
    const ranked = await engine.rank(repos, criteria, new Map(), 'test', 5);
    expect(ranked).toHaveLength(5);
  });

  it('normalizes stars correctly', async () => {
    const zeroStar = makeMockRepo({ id: 1, stars: 0, full_name: 'a/zero' });
    const hundredK = makeMockRepo({ id: 2, stars: 100000, full_name: 'a/huge' });

    const readmeStr = 'CI/CD Docker platform';
    const readmes = new Map<number, string | null>([[1, readmeStr], [2, readmeStr]]);
    const ranked = await engine.rank([zeroStar, hundredK], criteria, readmes, 'CI/CD', 10);
    expect(ranked[1].score.starsScore).toBe(0);
    expect(ranked[0].score.starsScore).toBe(1);
  });

  it('scores recently updated repos higher', async () => {
    const recent = makeMockRepo({ id: 1, full_name: 'a/recent', updated_at: new Date().toISOString() });
    const old = makeMockRepo({ id: 2, full_name: 'a/old', updated_at: '2019-01-01T00:00:00Z' });

    const readmeStr = 'CI/CD Docker tool';
    const readmes = new Map<number, string | null>([[1, readmeStr], [2, readmeStr]]);
    const ranked = await engine.rank([recent, old], criteria, readmes, 'CI/CD', 10);
    expect(ranked[0].score.activityScore).toBeGreaterThan(ranked[1].score.activityScore);
  });

  it('applies weight emphasis multipliers', () => {
    const repo = makeMockRepo({
      full_name: 'org/test',
      description: 'A test repo',
      stars: 5000,
      language: 'Go',
      license: { key: 'mit', name: 'MIT' },
      updated_at: new Date().toISOString(),
    });

    const noEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool');

    const emphasis = {
      semanticMatch: 2.0,
      starsScore: 1.0,
      activityScore: 1.0,
      readmeRelevance: 1.0,
      languageMatch: 1.0,
      licenseCompatibility: 1.0,
    };

    const withEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool', emphasis);

    // With semanticMatch emphasis at 2.0, the total should differ
    expect(withEmphasis.total).not.toBe(noEmphasis.total);
  });

  it('emphasis of 1.0 on all signals produces same scores as no emphasis', () => {
    const repo = makeMockRepo({
      full_name: 'org/test',
      description: 'A test repo',
      stars: 5000,
      language: 'Go',
      license: { key: 'mit', name: 'MIT' },
      updated_at: new Date().toISOString(),
    });

    const noEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool');

    const neutralEmphasis = {
      semanticMatch: 1.0,
      starsScore: 1.0,
      activityScore: 1.0,
      readmeRelevance: 1.0,
      languageMatch: 1.0,
      licenseCompatibility: 1.0,
    };

    const withEmphasis = engine.scoreRepo(repo, criteria, 'README content here', 'CI/CD tool', neutralEmphasis);

    expect(withEmphasis.total).toBe(noEmphasis.total);
  });
});
