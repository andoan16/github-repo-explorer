import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPerformanceTracker } from '../../src/main/search/perf';

describe('PerformanceTracker', () => {
  let currentTime = 0;

  beforeEach(() => {
    currentTime = 1000; // Start at an arbitrary non-zero time
    vi.spyOn(global.performance, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const advanceTime = (ms: number) => {
    currentTime += ms;
  };

  it('initializes correctly and returns default timings before start() is called', () => {
    const tracker = createPerformanceTracker();
    const timings = tracker.getTimings();

    // totalMs defaults to performance.now() - 0 if start() wasn't called
    expect(timings.totalMs).toBe(1000);

    // Check that all default phase durations are 0
    expect(timings.phase.ollamaMs).toBe(0);
    expect(timings.phase.githubSearchMs).toBe(0);
    expect(timings.phase.rankingMs).toBe(0);
    expect(timings.phase.readmeFetchMs).toBe(0);
    expect(timings.phase.vietnameseMs).toBe(0);
    expect(timings.phase.mergeMs).toBe(0);
    expect(timings.phase.suggestionMs).toBe(0);
    expect(timings.phase.dedupMs).toBe(0);
    expect(timings.phase.phase1Ms).toBe(0);
    expect(timings.phase.phase2Ms).toBe(0);

    // Check default cache metrics
    expect(timings.cache).toEqual({
      criteriaHits: 0, criteriaMisses: 0, criteriaSize: 0,
      searchHits: 0, searchMisses: 0, searchSize: 0,
      readmeHits: 0, readmeMisses: 0, readmeSize: 0,
    });
  });

  it('tracks total time correctly using start()', () => {
    const tracker = createPerformanceTracker();
    tracker.start(); // t0 = 1000

    advanceTime(500); // currentTime = 1500

    const timings = tracker.getTimings();
    expect(timings.totalMs).toBe(500);
  });

  it('tracks duration of a single phase correctly', () => {
    const tracker = createPerformanceTracker();
    tracker.start();

    tracker.beginPhase('ollama'); // starts at 1000
    advanceTime(250); // currentTime = 1250
    tracker.endPhase('ollama'); // duration = 250

    const timings = tracker.getTimings();
    expect(timings.phase.ollamaMs).toBe(250);
  });

  it('aggregates durations if a phase is run multiple times', () => {
    const tracker = createPerformanceTracker();

    tracker.beginPhase('github');
    advanceTime(100);
    tracker.endPhase('github');

    advanceTime(50);

    tracker.beginPhase('github');
    advanceTime(150);
    tracker.endPhase('github');

    const timings = tracker.getTimings();
    expect(timings.phase.githubSearchMs).toBe(250); // 100 + 150
  });

  it('handles multiple concurrent phases', () => {
    const tracker = createPerformanceTracker();

    tracker.beginPhase('phase1'); // t = 1000
    advanceTime(10);
    tracker.beginPhase('github'); // t = 1010

    advanceTime(200); // t = 1210
    tracker.endPhase('github'); // github duration: 200

    tracker.beginPhase('ranking'); // t = 1210
    advanceTime(50); // t = 1260
    tracker.endPhase('ranking'); // ranking duration: 50

    tracker.endPhase('phase1'); // phase1 duration: 260

    const timings = tracker.getTimings();
    expect(timings.phase.phase1Ms).toBe(260);
    expect(timings.phase.githubSearchMs).toBe(200);
    expect(timings.phase.rankingMs).toBe(50);
  });

  it('ignores endPhase if beginPhase was not called', () => {
    const tracker = createPerformanceTracker();

    // Should not throw or record anything
    tracker.endPhase('ollama');

    const timings = tracker.getTimings();
    expect(timings.phase.ollamaMs).toBe(0);
  });

  it('allows overriding cache metrics', () => {
    const tracker = createPerformanceTracker();

    const customCache = {
      criteriaHits: 1, criteriaMisses: 2, criteriaSize: 3,
      searchHits: 4, searchMisses: 5, searchSize: 6,
      readmeHits: 7, readmeMisses: 8, readmeSize: 9,
    };

    tracker.setCacheMetrics(customCache);

    const timings = tracker.getTimings();
    expect(timings.cache).toEqual(customCache);
  });

  it('handles phase durations that are unmapped or default to 0 gracefully', () => {
    const tracker = createPerformanceTracker();

    tracker.beginPhase('unknown_phase');
    advanceTime(50);
    tracker.endPhase('unknown_phase');

    // unknown_phase doesn't crash the tracker, and isn't included in the fixed mapped timings.
    // Ensure getTimings() still works and predefined phases are 0.
    const timings = tracker.getTimings();
    expect(timings.phase.ollamaMs).toBe(0);
  });
});
