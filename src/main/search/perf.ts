export interface SearchTimings {
  totalMs: number;
  phase: {
    ollamaMs: number;
    githubSearchMs: number;
    rankingMs: number;
    readmeFetchMs: number;
  };
  cache: {
    criteriaHits: number;
    criteriaMisses: number;
    criteriaSize: number;
    searchHits: number;
    searchMisses: number;
    searchSize: number;
    readmeHits: number;
    readmeMisses: number;
    readmeSize: number;
  };
}

class PerformanceTracker {
  private t0 = 0;
  private phaseStarts = new Map<string, number>();
  private phaseDurations = new Map<string, number>();

  start(): void {
    this.t0 = performance.now();
  }

  beginPhase(name: string): void {
    this.phaseStarts.set(name, performance.now());
  }

  endPhase(name: string): void {
    const start = this.phaseStarts.get(name);
    if (start !== undefined) {
      const elapsed = performance.now() - start;
      this.phaseDurations.set(name, (this.phaseDurations.get(name) ?? 0) + elapsed);
    }
  }

  getTimings(): SearchTimings {
    return {
      totalMs: Math.round(performance.now() - this.t0),
      phase: {
        ollamaMs: Math.round(this.phaseDurations.get('ollama') ?? 0),
        githubSearchMs: Math.round(this.phaseDurations.get('github') ?? 0),
        rankingMs: Math.round(this.phaseDurations.get('ranking') ?? 0),
        readmeFetchMs: Math.round(this.phaseDurations.get('readme') ?? 0),
      },
      cache: { criteriaHits: 0, criteriaMisses: 0, criteriaSize: 0, searchHits: 0, searchMisses: 0, searchSize: 0, readmeHits: 0, readmeMisses: 0, readmeSize: 0 },
    };
  }

  setCacheMetrics(metrics: SearchTimings['cache']): void {
    // will be filled in during finalize
  }
}

export function createPerformanceTracker(): PerformanceTracker {
  return new PerformanceTracker();
}
