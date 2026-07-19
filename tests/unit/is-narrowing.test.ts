import { describe, it, expect } from 'vitest';
import { RefinementParser } from '../../src/main/search/refinement-parser';

describe('RefinementParser.isNarrowing', () => {
  it('detects narrowing: "only Go projects"', () => {
    expect(RefinementParser.isNarrowing('only Go projects')).toBe(true);
  });

  it('detects narrowing: "above 500 stars"', () => {
    expect(RefinementParser.isNarrowing('above 500 stars')).toBe(true);
  });

  it('detects narrowing: ">1000"', () => {
    expect(RefinementParser.isNarrowing('>1000')).toBe(true);
  });

  it('detects narrowing: "less Kubernetes"', () => {
    expect(RefinementParser.isNarrowing('less Kubernetes')).toBe(true);
  });

  it('detects narrowing: "exclude unlicensed"', () => {
    expect(RefinementParser.isNarrowing('exclude unlicensed')).toBe(true);
  });

  it('detects broadening: "more DevOps"', () => {
    expect(RefinementParser.isNarrowing('more DevOps')).toBe(false);
  });

  it('detects broadening: "explore alternatives"', () => {
    expect(RefinementParser.isNarrowing('explore alternatives')).toBe(false);
  });

  it('detects broadening: "similar projects"', () => {
    expect(RefinementParser.isNarrowing('similar projects')).toBe(false);
  });

  it('detects broadening: "less popular" is not narrowing', () => {
    expect(RefinementParser.isNarrowing('less popular')).toBe(false);
  });

  it('detects broadening: "fewer stars" is not narrowing', () => {
    expect(RefinementParser.isNarrowing('fewer stars')).toBe(false);
  });

  it('detects narrowing: "narrow down"', () => {
    expect(RefinementParser.isNarrowing('narrow down')).toBe(true);
  });

  it('returns false for generic text without clear direction', () => {
    expect(RefinementParser.isNarrowing('something random')).toBe(false);
  });

  it('detects star sort as narrowing', () => {
    expect(RefinementParser.isNarrowing('highest stars')).toBe(true);
  });

  it('detects "just Python" as narrowing', () => {
    expect(RefinementParser.isNarrowing('just Python')).toBe(true);
  });

  it('detects "filter to TypeScript" as narrowing', () => {
    expect(RefinementParser.isNarrowing('filter to TypeScript')).toBe(true);
  });
});