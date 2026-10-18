import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPerformanceTracker } from '../../src/main/search/perf';

describe('PerformanceTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tracks overall time correctly', () => {
    const tracker = createPerformanceTracker();

    vi.setSystemTime(1000);
    // @ts-ignore
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    tracker.start();

    vi.setSystemTime(1500);
    // @ts-ignore
    vi.spyOn(performance, 'now').mockReturnValue(1500);
    const timings = tracker.getTimings();

    expect(timings.totalMs).toBe(500);
  });

  it('tracks phase durations', () => {
    const tracker = createPerformanceTracker();

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100) // start
      .mockReturnValueOnce(150) // beginPhase
      .mockReturnValueOnce(200); // endPhase

    tracker.start();
    tracker.beginPhase('ollama');
    tracker.endPhase('ollama');

    vi.spyOn(performance, 'now').mockReturnValue(250); // getTimings (total ms)
    const timings = tracker.getTimings();

    expect(timings.phase.ollamaMs).toBe(50);
    expect(timings.totalMs).toBe(150);
  });

  it('accumulates durations for the same phase', () => {
    const tracker = createPerformanceTracker();
    tracker.start();

    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    time = 100;
    tracker.beginPhase('github');
    time = 150;
    tracker.endPhase('github'); // 50ms

    time = 200;
    tracker.beginPhase('github');
    time = 300;
    tracker.endPhase('github'); // 100ms

    const timings = tracker.getTimings();
    expect(timings.phase.githubSearchMs).toBe(150);
  });

  it('sets cache metrics correctly', () => {
    const tracker = createPerformanceTracker();

    const mockCacheMetrics = {
      criteriaHits: 1,
      criteriaMisses: 2,
      criteriaSize: 3,
      searchHits: 4,
      searchMisses: 5,
      searchSize: 6,
      readmeHits: 7,
      readmeMisses: 8,
      readmeSize: 9,
    };

    tracker.setCacheMetrics(mockCacheMetrics);

    vi.spyOn(performance, 'now').mockReturnValue(0);
    const timings = tracker.getTimings();

    expect(timings.cache).toEqual(mockCacheMetrics);
  });

  it('provides default cache metrics if none set', () => {
    const tracker = createPerformanceTracker();

    vi.spyOn(performance, 'now').mockReturnValue(0);
    const timings = tracker.getTimings();

    expect(timings.cache).toEqual({
      criteriaHits: 0, criteriaMisses: 0, criteriaSize: 0,
      searchHits: 0, searchMisses: 0, searchSize: 0,
      readmeHits: 0, readmeMisses: 0, readmeSize: 0,
    });
  });

  it('handles tracking specific phase boundaries like phase1 and phase2', () => {
    const tracker = createPerformanceTracker();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    tracker.start();

    tracker.beginPhase('phase1');
    time = 100;
    tracker.endPhase('phase1');

    time = 150;
    tracker.beginPhase('phase2');
    time = 300;
    tracker.endPhase('phase2');

    const timings = tracker.getTimings();
    expect(timings.phase.phase1Ms).toBe(100);
    expect(timings.phase.phase2Ms).toBe(150);
  });

  it('safely handles ending a phase that was not started', () => {
    const tracker = createPerformanceTracker();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    tracker.start();
    // End without starting
    tracker.endPhase('ranking');

    const timings = tracker.getTimings();
    expect(timings.phase.rankingMs).toBe(0);
  });
});
