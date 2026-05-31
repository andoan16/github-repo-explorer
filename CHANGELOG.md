# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-06-01

### Added

- **Multilingual Vietnamese search support** — end-to-end Vietnamese query pipeline:
  - Vietnamese text detection using Unicode ranges + marker-word matching
  - Local dictionary expansion (~80-entry tech dictionary, no LLM required)
  - Optional LLM enhancement producing English translations and technical concepts
  - Cross-language semantic matching in ranking engine (`readmeSignalMultilingual`)
  - Vietnamese refinement detection for local fast-paths
  - Translation cache (TTL 30min, LRU 200) to avoid repeated Ollama calls

- **Performance caches and architecture**:
  - LRU search cache with TTL, query normalization, and hit/miss metrics
  - CriteriaCache — 30-min TTL, 100-entry LRU to skip repeated Ollama calls
  - README cache with negative-result caching (404s) and AbortSignal threading
  - `boundedAllSettled` concurrency utility (worker-pool pattern, configurable limit)
  - Two-stage ranking: metadata-only first, README fetch for top 10, re-rank enriched
  - `PerformanceTracker` for phase-level timing (ollama, github, ranking, readme) with cache metric aggregation

- **RefinementParser local handlers** — bypass LLM for common refinements:
  - Language preference (`prefer Go`, `python only`)
  - License preference (`MIT license`, `open source only`)
  - Topic adjustment (`more DevOps`, `less Kubernetes`)
  - Star-heavy / recency-heavy emphasis patterns

- **AbortController lifecycle** — wired through GitHub API, Ollama, and README fetches with generation-based cancellation and proper cleanup

### Fixed

- Async callback handling in ranking unit tests (`await engine.rank(...)`)

### Chore

- Stop tracking `.claude` and `.idea` directories