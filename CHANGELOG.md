# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2026-11-15

### Added

- **Tiered Embedded LLM Runtime (`node-llama-cpp`)**:
  - Zero-config local LLM inference without requiring external Ollama installation.
  - Three embedded Qwen2.5 GGUF model tiers: Tier 1 (0.5B, ~398MB), Tier 2 (1.5B, ~986MB), Tier 3 (3B, ~1.9GB).
  - Automated hardware specs detection (`getSystemSpecs`) evaluating RAM and CPU cores to recommend optimal model tier.
  - In-app model download manager with real-time download percentage progress and background loading.
  - Dual LLM provider support: seamlessly toggle between embedded local LLM and external Ollama (Local and Ollama Cloud with API key).

- **Search Precision Optimizer & Hybrid Ranking**:
  - `CodeAwareTokenizer` handling camelCase/PascalCase splitting (e.g. `pdfCraft` -> `pdf`, `craft`), scoped package preservation, and technical keyword retention (prevents stripping words like `class`, `server`, `for`).
  - Exact technical identifier boosting and Reciprocal Rank Fusion (RRF).
  - Semantic vector reranker (`vector-reranker.ts`) for cosine similarity reranking.
  - Query intent decomposer (`intent-decomposer.ts`) with intent-specific weight emphasis presets.
  - Stateful `SearchSession` management tracking queries, cursor pagination, and refinement stack.
  - Decoupled `vietnamese-data.ts` dictionary and linguistic rules.

- **Modular Domain IPC Architecture**:
  - Refactored monolithic IPC handlers into single-responsibility domain modules (`search.handler.ts`, `llm.handler.ts`, `git.handler.ts`, `bookmark.handler.ts`, and `settings.handler.ts`).

- **Benchmarking & Load Testing Suites**:
  - 30-Query Golden IR Benchmark suite (`tests/fixtures/golden_queries.json` and `search-evaluator-benchmark.test.ts`) evaluating Precision@5, Recall@5, MRR, and NDCG@10.
  - Full search accuracy pipeline test (`llm-search-accuracy.test.ts`).
  - Grafana k6 load-testing suite (`scripts/k6/load-test.js`) and standalone HTTP load testing harness (`scripts/load-test-server.ts`).
  - Expanded unit and integration test coverage to 671 total automated tests (606 unit, 65 integration).

### Performance & Optimizations

- Optimized string allocations in sliding window ranking, `mineNegativeSpace`, and `normalizeVietnameseQuery`.
- Precompiled RegExp objects across Vietnamese query processing.
- Optimized license matching with `Set` lookups.
- Optimized array `.includes()` in `guaranteeCoverage` with `Set` lookups.
- Improved GitHub API rate-limit tracking, cache metrics, and search supersession cancellation.

### Fixed

- Prevented scroll jumps to top on lazy-load / pagination in repository list.
- Fixed hoisted Vietnamese detection to properly support simple/atomic queries.
- Preserved Unicode characters in `extractFastKeywords` and `normalizeWords`.
- Fixed SettingsStore file persistence in test environments.
- Allowed external images in Content Security Policy (CSP) for safe, rich README rendering.

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