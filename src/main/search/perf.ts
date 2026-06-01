import { type SearchTimings } from '../../shared/types';

class PerformanceTracker {
  private t0 = 0;
  private phase1Start = 0;
  private phase2Start = 0;
  private phaseStarts = new Map<string, number>();
  private phaseDurations = new Map<string, number>();
  private _cache: SearchTimings['cache'] | null = null;

  start(): void {
    this.t0 = performance.now();
  }

  beginPhase(name: string): void {
    this.phaseStarts.set(name, performance.now());
    // Track phase1/phase2 boundaries
    if (name === 'phase1') this.phase1Start = performance.now();
    if (name === 'phase2') this.phase2Start = performance.now();
  }

  endPhase(name: string): void {
    const start = this.phaseStarts.get(name);
    if (start !== undefined) {
      const elapsed = performance.now() - start;
      this.phaseDurations.set(name, (this.phaseDurations.get(name) ?? 0) + elapsed);
      this.phaseStarts.delete(name);
    }
  }

  setCacheMetrics(c: SearchTimings['cache']): void {
    this._cache = c;
  }

  getTimings(): SearchTimings {
    return {
      totalMs: Math.round(performance.now() - this.t0),
      phase: {
        ollamaMs: Math.round(this.phaseDurations.get('ollama') ?? 0),
        githubSearchMs: Math.round(this.phaseDurations.get('github') ?? 0),
        rankingMs: Math.round(this.phaseDurations.get('ranking') ?? 0),
        readmeFetchMs: Math.round(this.phaseDurations.get('readme') ?? 0),
        vietnameseMs: Math.round(this.phaseDurations.get('vietnamese') ?? 0),
        mergeMs: Math.round(this.phaseDurations.get('merge') ?? 0),
        suggestionMs: Math.round(this.phaseDurations.get('suggestion') ?? 0),
        dedupMs: Math.round(this.phaseDurations.get('dedup') ?? 0),
        phase1Ms: Math.round(this.phaseDurations.get('phase1') ?? 0),
        phase2Ms: Math.round(this.phaseDurations.get('phase2') ?? 0),
      },
      cache: this._cache ?? {
        criteriaHits: 0, criteriaMisses: 0, criteriaSize: 0,
        searchHits: 0, searchMisses: 0, searchSize: 0,
        readmeHits: 0, readmeMisses: 0, readmeSize: 0,
      },
    };
  }
}

export function createPerformanceTracker(): PerformanceTracker {
  return new PerformanceTracker();
}
