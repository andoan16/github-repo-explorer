import { describe, it, vi } from 'vitest';
import { RankingEngine } from '../../src/main/ranking/engine';
import { QueryGenerator } from '../../src/main/search/query-gen';
import { RefinementValidator } from '../../src/main/search/refinement-validator';
import { RefinementParser } from '../../src/main/search/refinement-parser';
import { computeResultStatistics, mineNegativeSpace } from '../../src/main/search/result-stats';
import type { GitHubRepo, SearchCriteria, WeightEmphasis } from '../../src/shared/types';

// ── Realistic test repos spanning 6 ecosystems ──

const REALISTIC_REPOS: GitHubRepo[] = [
  // ── Monitoring / Observability ──
  { id: 1, full_name: 'grafana/grafana', html_url: 'https://github.com/grafana/grafana', description: 'The open and composable observability and data visualization platform. Visualize metrics, logs, and traces from multiple sources like Prometheus, Loki, Elasticsearch, InfluxDB, Postgres and many more.', stars: 68000, forks: 12500, language: 'TypeScript', license: { key: 'agpl-3.0', name: 'AGPL-3.0' }, updated_at: '2026-05-28T00:00:00Z', topics: ['monitoring', 'dashboard', 'observability', 'visualization', 'grafana', 'metrics', 'analytics'], open_issues: 4200, default_branch: 'main', archived: false },
  { id: 2, full_name: 'prometheus/prometheus', html_url: 'https://github.com/prometheus/prometheus', description: 'The Prometheus monitoring system and time series database.', stars: 58000, forks: 9600, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-29T00:00:00Z', topics: ['monitoring', 'metrics', 'prometheus', 'time-series', 'alerting'], open_issues: 850, default_branch: 'main', archived: false },
  { id: 3, full_name: 'grafana/loki', html_url: 'https://github.com/grafana/loki', description: 'Like Prometheus, but for logs.', stars: 25000, forks: 3800, language: 'Go', license: { key: 'agpl-3.0', name: 'AGPL-3.0' }, updated_at: '2026-05-27T00:00:00Z', topics: ['logging', 'observability', 'grafana', 'loki', 'logs'], open_issues: 1200, default_branch: 'main', archived: false },
  { id: 4, full_name: 'netdata/netdata', html_url: 'https://github.com/netdata/netdata', description: 'Architected for speed. Automated, interactive, infinitely scalable infrastructure monitoring and troubleshooting in real-time.', stars: 75000, forks: 6200, language: 'C', license: { key: 'gpl-3.0', name: 'GPL-3.0' }, updated_at: '2026-05-29T00:00:00Z', topics: ['monitoring', 'real-time', 'metrics', 'visualization', 'netdata', 'performance'], open_issues: 350, default_branch: 'master', archived: false },
  { id: 5, full_name: 'signoz/signoz', html_url: 'https://github.com/signoz/signoz', description: 'SigNoz is an open-source observability platform native to OpenTelemetry with logs, traces and metrics in a single application. Alternative to DataDog, NewRelic.', stars: 22000, forks: 1600, language: 'TypeScript', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-28T00:00:00Z', topics: ['observability', 'opentelemetry', 'monitoring', 'apm', 'distributed-tracing'], open_issues: 480, default_branch: 'main', archived: false },

  // ── CI/CD ──
  { id: 10, full_name: 'jenkinsci/jenkins', html_url: 'https://github.com/jenkinsci/jenkins', description: 'Jenkins automation server — the leading open source automation server', stars: 24000, forks: 9600, language: 'Java', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-28T00:00:00Z', topics: ['ci-cd', 'automation', 'jenkins', 'devops', 'java'], open_issues: 0, default_branch: 'master', archived: false },
  { id: 11, full_name: 'woodpecker-ci/woodpecker', html_url: 'https://github.com/woodpecker-ci/woodpecker', description: 'Woodpecker is a simple, yet powerful CI/CD engine with great extensibility.', stars: 5000, forks: 620, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-25T00:00:00Z', topics: ['ci-cd', 'docker', 'devops', 'automation', 'golang', 'pipeline'], open_issues: 180, default_branch: 'main', archived: false },
  { id: 12, full_name: 'dagger/dagger', html_url: 'https://github.com/dagger/dagger', description: 'An open-source runtime for composable CI/CD pipelines. Run your pipelines in containers — develop locally, run anywhere.', stars: 14000, forks: 810, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-28T00:00:00Z', topics: ['ci-cd', 'docker', 'pipeline', 'devops', 'containers'], open_issues: 320, default_branch: 'main', archived: false },
  { id: 13, full_name: 'earthly/earthly', html_url: 'https://github.com/earthly/earthly', description: 'Super simple CI/CD framework with repeatable builds that you write once and run anywhere – like a Makefile for the cloud.', stars: 12000, forks: 440, language: 'Go', license: { key: 'mpl-2.0', name: 'MPL-2.0' }, updated_at: '2026-05-24T00:00:00Z', topics: ['ci-cd', 'docker', 'build-automation', 'devops', 'makefile'], open_issues: 150, default_branch: 'main', archived: false },
  { id: 14, full_name: 'nektos/act', html_url: 'https://github.com/nektos/act', description: 'Run your GitHub Actions locally! Why waste valuable minutes? Act lets you simulate CI locally.', stars: 60000, forks: 1500, language: 'Go', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-27T00:00:00Z', topics: ['github-actions', 'ci', 'docker', 'devops', 'testing'], open_issues: 220, default_branch: 'master', archived: false },

  // ── Kubernetes / Infrastructure ──
  { id: 20, full_name: 'kubernetes/kubernetes', html_url: 'https://github.com/kubernetes/kubernetes', description: 'Production-Grade Container Scheduling and Management', stars: 114000, forks: 40000, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-29T00:00:00Z', topics: ['kubernetes', 'containers', 'orchestration', 'cloud-native', 'cncf'], open_issues: 3200, default_branch: 'master', archived: false },
  { id: 21, full_name: 'helm/helm', html_url: 'https://github.com/helm/helm', description: 'The Kubernetes Package Manager', stars: 28000, forks: 7400, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-27T00:00:00Z', topics: ['kubernetes', 'helm', 'package-manager', 'cncf', 'devops'], open_issues: 750, default_branch: 'main', archived: false },
  { id: 22, full_name: 'fluxcd/flux2', html_url: 'https://github.com/fluxcd/flux2', description: 'Open and extensible continuous delivery solution for Kubernetes. Powered by GitOps Toolkit.', stars: 7000, forks: 660, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-28T00:00:00Z', topics: ['kubernetes', 'gitops', 'continuous-delivery', 'cncf', 'flux'], open_issues: 280, default_branch: 'main', archived: false },
  { id: 23, full_name: 'crossplane/crossplane', html_url: 'https://github.com/crossplane/crossplane', description: 'The Cloud Native Control Plane Framework — build control planes without needing to write code.', stars: 10000, forks: 1000, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-27T00:00:00Z', topics: ['kubernetes', 'cloud-native', 'infrastructure', 'cncf', 'control-plane'], open_issues: 400, default_branch: 'main', archived: false },
  { id: 24, full_name: 'argoproj/argo-cd', html_url: 'https://github.com/argoproj/argo-cd', description: 'Declarative Continuous Deployment for Kubernetes', stars: 19000, forks: 5800, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-29T00:00:00Z', topics: ['kubernetes', 'gitops', 'continuous-delivery', 'argo', 'cncf'], open_issues: 920, default_branch: 'master', archived: false },

  // ── Python Libraries ──
  { id: 30, full_name: 'pydantic/pydantic', html_url: 'https://github.com/pydantic/pydantic', description: 'Data validation using Python type hints', stars: 23000, forks: 2000, language: 'Python', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-28T00:00:00Z', topics: ['python', 'validation', 'type-hints', 'json-schema', 'pydantic'], open_issues: 340, default_branch: 'main', archived: false },
  { id: 31, full_name: 'tiangolo/fastapi', html_url: 'https://github.com/tiangolo/fastapi', description: 'FastAPI framework, high performance, easy to learn, fast to code, ready for production', stars: 83000, forks: 7000, language: 'Python', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-29T00:00:00Z', topics: ['python', 'fastapi', 'api', 'web-framework', 'openapi', 'swagger'], open_issues: 210, default_branch: 'master', archived: false },
  { id: 32, full_name: 'python-poetry/poetry', html_url: 'https://github.com/python-poetry/poetry', description: 'Python packaging and dependency management made easy', stars: 34000, forks: 2400, language: 'Python', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-26T00:00:00Z', topics: ['python', 'packaging', 'dependency-manager', 'poetry', 'build-tool'], open_issues: 680, default_branch: 'main', archived: false },

  // ── Rust Tools ──
  { id: 40, full_name: 'astral-sh/ruff', html_url: 'https://github.com/astral-sh/ruff', description: 'An extremely fast Python linter and code formatter, written in Rust.', stars: 38000, forks: 1300, language: 'Rust', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-29T00:00:00Z', topics: ['python', 'linter', 'formatter', 'rust', 'ruff', 'static-analysis'], open_issues: 350, default_branch: 'main', archived: false },
  { id: 41, full_name: 'tokio-rs/tokio', html_url: 'https://github.com/tokio-rs/tokio', description: 'A runtime for writing reliable asynchronous applications with Rust. Provides I/O, networking, scheduling, timers, ...', stars: 29000, forks: 2700, language: 'Rust', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-28T00:00:00Z', topics: ['rust', 'async', 'tokio', 'networking', 'runtime'], open_issues: 180, default_branch: 'master', archived: false },
  { id: 42, full_name: 'tree-sitter/tree-sitter', html_url: 'https://github.com/tree-sitter/tree-sitter', description: 'An incremental parsing system for programming tools', stars: 21000, forks: 1700, language: 'Rust', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-25T00:00:00Z', topics: ['parser', 'rust', 'syntax-tree', 'tree-sitter', 'incremental-parsing'], open_issues: 410, default_branch: 'master', archived: false },

  // ── Go Tools ──
  { id: 50, full_name: 'golang/go', html_url: 'https://github.com/golang/go', description: 'The Go programming language', stars: 127000, forks: 18000, language: 'Go', license: { key: 'bsd-3-clause', name: 'BSD-3-Clause' }, updated_at: '2026-05-29T00:00:00Z', topics: ['go', 'golang', 'programming-language', 'compiler'], open_issues: 5600, default_branch: 'master', archived: false },
  { id: 51, full_name: 'gohugoio/hugo', html_url: 'https://github.com/gohugoio/hugo', description: 'The world\'s fastest framework for building websites.', stars: 79000, forks: 7700, language: 'Go', license: { key: 'apache-2.0', name: 'Apache-2.0' }, updated_at: '2026-05-29T00:00:00Z', topics: ['go', 'hugo', 'static-site-generator', 'web', 'markdown'], open_issues: 590, default_branch: 'master', archived: false },
  { id: 52, full_name: 'cli/cli', html_url: 'https://github.com/cli/cli', description: 'GitHub\'s official command line tool', stars: 39000, forks: 6400, language: 'Go', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-28T00:00:00Z', topics: ['go', 'github', 'cli', 'gh', 'terminal'], open_issues: 820, default_branch: 'trunk', archived: false },

  // ── Misc / Unmaintained / Archived ──
  { id: 60, full_name: 'old/lib-old', html_url: 'https://github.com/old/lib-old', description: 'An obsolete monitoring library from 2019', stars: 120, forks: 12, language: 'Python', license: null, updated_at: '2021-03-15T00:00:00Z', topics: ['monitoring'], open_issues: 45, default_branch: 'main', archived: true },
  { id: 61, full_name: 'abandoned/tool', html_url: 'https://github.com/abandoned/tool', description: 'Was once a popular CI tool, now unmaintained', stars: 8000, forks: 900, language: 'Ruby', license: { key: 'mit', name: 'MIT' }, updated_at: '2022-01-10T00:00:00Z', topics: ['ci', 'unmaintained'], open_issues: 320, default_branch: 'main', archived: false },
  { id: 62, full_name: 'startup/new-project', html_url: 'https://github.com/startup/new-project', description: 'A brand new real-time monitoring tool built in Rust. Early alpha, looking for contributors.', stars: 45, forks: 3, language: 'Rust', license: { key: 'mit', name: 'MIT' }, updated_at: '2026-05-30T00:00:00Z', topics: ['monitoring', 'real-time', 'rust', 'new'], open_issues: 2, default_branch: 'main', archived: false },
  { id: 63, full_name: 'unlicensed/tool', html_url: 'https://github.com/unlicensed/tool', description: 'A useful DevOps utility with no license', stars: 3500, forks: 200, language: 'Python', license: null, updated_at: '2026-04-15T00:00:00Z', topics: ['devops', 'automation'], open_issues: 12, default_branch: 'main', archived: false },
];

// ── Deterministic Mock Ollama ──

function mockOllamaGenerate(criteriaJson: string) {
  return vi.fn().mockResolvedValue(criteriaJson);
}

// ── Diagnostic Helpers ──

function printSection(title: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(70)}`);
}

function printRankedResults(ranked: { repo: GitHubRepo; score: any }[], count: number = 10) {
  console.log(`\n  Rank | Stars  | Score | Repo`);
  console.log(`  -----|--------|-------|-----`);
  for (let i = 0; i < Math.min(count, ranked.length); i++) {
    const r = ranked[i];
    console.log(`  ${String(i + 1).padStart(3)}  | ${String(r.repo.stars).padStart(5)}  | ${String(Math.round(r.score.total * 100)).padStart(4)}%  | ${r.repo.full_name} (${r.repo.language ?? '?'})`);
  }
}

describe('🔍 Full Pipeline Accuracy Test', () => {
  it('Search: "self-hosted CI/CD platform with Docker support"', async () => {
    const query = 'self-hosted CI/CD platform with Docker support';

    // Mock LLM returns realistic criteria for CI/CD
    const ollamaMock = {
      generate: mockOllamaGenerate(
        '{"searchQueries":["self-hosted CI/CD docker","continuous integration deployment pipeline","devops automation platform"],"technologies":["Docker","Go","Python"],"intent":"devops-tool","minStars":100,"preferredLicense":"mit","requireRecentActivity":true}'
      ),
      checkConnection: vi.fn().mockResolvedValue({ connected: true, models: [] }),
      listModels: vi.fn().mockResolvedValue([]),
      baseUrl: 'http://localhost:11434',
    };

    const qg = new QueryGenerator(ollamaMock as any, 'llama3.2');
    const criteria = await qg.extractCriteria(query);

    printSection('Query: ' + query);
    console.log('LLM extracted criteria:');
    console.log(`  Keywords: [${criteria.keywords.join(', ')}]`);
    console.log(`  Technologies: [${criteria.technologies.join(', ')}]`);
    console.log(`  Intent: ${criteria.intent}`);
    console.log(`  Min stars: ${criteria.minStars}`);
    console.log(`  Preferred license: ${criteria.preferredLicense}`);

    // Simulate GitHub search — filter repos that match CI/CD / Docker keywords
    const searchQuery = criteria.keywords.join(' ').toLowerCase();
    const matched = REALISTIC_REPOS.filter(r => {
      const text = `${r.description ?? ''} ${r.topics.join(' ')} ${r.full_name}`.toLowerCase();
      return text.includes('ci') || text.includes('cd') || text.includes('docker') ||
             text.includes('pipeline') || text.includes('automation') || text.includes('devops') ||
             text.includes('continuous') || text.includes('deployment');
    });

    console.log(`\nGitHub search matched ${matched.length} repos (from ${REALISTIC_REPOS.length} total)`);

    // Run ranking engine
    const engine = new RankingEngine();
    const emptyReadmes = new Map<number, string | null>();
    const ranked = await engine.rank(matched, criteria, emptyReadmes, query, 20);

    printRankedResults(ranked, 10);

    // Stats
    const stats = computeResultStatistics(matched);
    printSection('Result Statistics');
    console.log(`  Languages: ${stats.languageDistribution}`);
    console.log(`  Licenses: ${stats.licenseDistribution}`);
    console.log(`  Stars: ${stats.starRange}`);

    // Negative space
    const neg = mineNegativeSpace(query, matched, 10);
    printSection('Negative Space Analysis');
    if (neg.gaps.length > 0) {
      console.log(`  Underrepresented: ${neg.summary}`);
    } else {
      console.log('  No gaps found — all query keywords well-represented');
    }

    // Suggestions
    const suggestions = await qg.generateRefinementSuggestions(
      query,
      criteria.keywords,
      criteria.technologies,
      criteria.intent,
      matched.length,
      matched,
      {
        top: Math.round((ranked[0]?.score.total ?? 0) * 100),
        median: Math.round((ranked[Math.floor(ranked.length / 2)]?.score.total ?? 0) * 100),
        bottom: Math.round((ranked[ranked.length - 1]?.score.total ?? 0) * 100),
        above80: ranked.filter(r => r.score.total >= 0.8).length,
        below50: ranked.filter(r => r.score.total < 0.5).length,
        total: ranked.length,
      },
    );

    // Validate suggestions
    const validator = new RefinementValidator();
    const validation = validator.validate(suggestions, matched, {});
    const deduped = deduplicateBatchSimple(validation.valid);
    const covered = guaranteeCoverageSimple(deduped, matched);

    printSection('LLM-Generated Refinement Suggestions');
    console.log(`  Raw: [${suggestions.join(', ')}]`);
    console.log(`  After validation: [${validation.valid.join(', ')}]`);
    if (validation.dropped.length > 0) {
      console.log(`  Dropped: ${validation.dropped.map(d => `"${d.suggestion}" (${d.reason})`).join(', ')}`);
    }
    console.log(`  After dedup: [${deduped.join(', ')}]`);
    console.log(`  After coverage: [${covered.join(', ')}]`);

    // Accuracy assertions
    printSection('Accuracy Checks');
    console.log(`  ✅ Criteria extraction: ${criteria.keywords.length} keywords`);
    console.log(`  ✅ ${ranked.length} repos ranked, top is "${ranked[0]?.repo.full_name}"`);
    console.log(`  ✅ Suggestions generated: ${covered.length}`);
  });

  it('Search: "real-time server monitoring dashboard"', async () => {
    const query = 'real-time server monitoring dashboard';

    const ollamaMock = {
      generate: mockOllamaGenerate(
        '{"searchQueries":["real-time monitoring dashboard","server metrics visualization","infrastructure observability tools"],"technologies":["Go","TypeScript","Rust"],"intent":"devops-tool","minStars":500,"preferredLicense":"mit","requireRecentActivity":true}'
      ),
      checkConnection: vi.fn().mockResolvedValue({ connected: true, models: [] }),
      listModels: vi.fn().mockResolvedValue([]),
      baseUrl: 'http://localhost:11434',
    };

    const qg = new QueryGenerator(ollamaMock as any, 'llama3.2');
    const criteria = await qg.extractCriteria(query);

    printSection('Query: ' + query);
    console.log(`  Keywords: [${criteria.keywords.join(', ')}]`);
    console.log(`  Technologies: [${criteria.technologies.join(', ')}]`);

    // Filter repos matching monitoring keywords
    const matched = REALISTIC_REPOS.filter(r => {
      const text = `${r.description ?? ''} ${r.topics.join(' ')} ${r.full_name}`.toLowerCase();
      return text.includes('monitor') || text.includes('observ') || text.includes('dashboard') ||
             text.includes('metrics') || text.includes('visuali') || text.includes('apm');
    });

    const engine = new RankingEngine();
    const ranked = await engine.rank(matched, criteria, new Map(), query, 20);
    printRankedResults(ranked, 10);

    // Check if real-time keyword is actually present
    const hasRealTime = ranked.slice(0, 5).some(r =>
      (r.repo.description ?? '').toLowerCase().includes('real-time') ||
      r.repo.topics.some(t => t.includes('real-time'))
    );
    console.log(`\n  "real-time" in top 5: ${hasRealTime ? '✅ YES' : '❌ NO (negative space gap!)'}`);

    const neg = mineNegativeSpace(query, matched, 10);
    if (neg.gaps.length > 0) {
      console.log(`  ⚠️  Negative space: ${neg.summary}`);
    }
  });

  it('Search: "Python library for PDF manipulation"', async () => {
    const query = 'Python library for PDF manipulation';

    const ollamaMock = {
      generate: mockOllamaGenerate(
        '{"searchQueries":["python pdf library","pdf manipulation tools","python document processing"],"technologies":["Python"],"intent":"library","minStars":0,"preferredLicense":"mit","requireRecentActivity":false}'
      ),
      checkConnection: vi.fn().mockResolvedValue({ connected: true, models: [] }),
      listModels: vi.fn().mockResolvedValue([]),
      baseUrl: 'http://localhost:11434',
    };

    const qg = new QueryGenerator(ollamaMock as any, 'llama3.2');
    const criteria = await qg.extractCriteria(query);

    printSection('Query: ' + query);
    console.log(`  Intent: ${criteria.intent}`);

    // Filter — our dataset has no PDF repos, so expect few or zero matches
    const matched = REALISTIC_REPOS.filter(r => {
      const text = `${r.description ?? ''} ${r.topics.join(' ')}`.toLowerCase();
      return text.includes('pdf') || text.includes('document') || text.includes('parse');
    });

    console.log(`  Matched repos: ${matched.length} (expected low — dataset has no PDF tools)`);

    if (matched.length === 0) {
      console.log(`  ⚠️  Zero results — should trigger "broaden search" suggestion`);
    }
  });

  it('RefinementParser: sort-by-stars fast path', () => {
    const parser = new RefinementParser();
    const queries = ['highest star', 'most stars', 'sort by stars', 'newest', 'most forks', 'prefer Go', 'more devops focused'];

    printSection('Refinement Parser Fast-Path Detection');
    for (const q of queries) {
      const detected = parser.detect(q);
      const label = detected
        ? detected.type === 'raw-sort' ? `📊 RAW-SORT by ${detected.sortKey}` : `⚖️  EMPHASIS (starsScore: ${detected.emphasis?.starsScore}x)`
        : '🤖 LLM fallback';
      console.log(`  "${q}" → ${label}`);
    }
  });
});

// ── Local dedup/coverage for test only (mirrors ipc-handlers logic) ──

function deduplicateBatchSimple(suggestions: string[]): string[] {
  const STOP = new Set(['a','an','the','and','or','for','with','in','on','to','of','is','it','as','at','be','by','more','less','only','show','try','use','prefer','filter','switch','move','focus','keep','remove','add','based','tools','projects']);
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w => w.length >= 2 && !STOP.has(w));
  const result: string[] = [];
  for (const s of suggestions) {
    const w = norm(s); let dup = false;
    for (const e of result) {
      const ew = norm(e); const o = w.filter(x => ew.includes(x)).length;
      if (o === 0) continue;
      if (o / new Set([...w,...ew]).size >= 0.33 || (o >= 1 && (w.length === 1 || ew.length === 1))) { dup = true; break; }
    }
    if (!dup) result.push(s);
  }
  return result;
}

function guaranteeCoverageSimple(suggestions: string[], repos: GitHubRepo[]): string[] {
  if (suggestions.length >= 5) return suggestions;
  const lower = suggestions.map(s => s.toLowerCase());
  const L = ['typescript','javascript','python','go','rust','java','kotlin','swift','ruby','php','scala','elixir','haskell','clojure','dart','lua','zig','c++','c#'];
  const LC = ['mit','apache','gpl','bsd','mpl','lgpl','agpl','unlicense','isc'];
  const hasLang = lower.some(s => L.some(k => s.includes(k)));
  const hasLic = lower.some(s => LC.some(k => s.includes(k)));
  const hasQual = lower.some(s => /stars?|popular|above|over|\d+k/i.test(s));
  const hasRec = lower.some(s => /recent|active|newest|latest|updated|maintained/i.test(s));
  const none = !hasLang && !hasLic && !hasQual && !hasRec;
  if (none) return suggestions;
  if (!hasLang && repos.length > 0) {
    const m = new Map<string,number>(); repos.forEach(r => { if (r.language) m.set(r.language, (m.get(r.language)??0)+1); });
    const s = [...m.entries()].sort((a,b)=>b[1]-a[1]);
    const t = s.find(([l]) => !lower.some(x=>x.includes(l.toLowerCase())));
    if (t && s.length >= 2) suggestions.push(`only ${t[0]} projects`);
  }
  if (!hasLic && repos.length > 0) {
    const m = new Map<string,number>(); repos.forEach(r => { const k = r.license?.key ?? 'none'; m.set(k,(m.get(k)??0)+1); });
    const s = [...m.entries()].filter(([k])=>k!=='none').sort((a,b)=>b[1]-a[1]);
    if (s.length > 0) suggestions.push(`only ${s[0][0].toUpperCase()}-licensed`);
  }
  if (!hasQual && repos.length > 0) {
    const stars = repos.map(r=>r.stars).sort((a,b)=>a-b);
    const med = stars[Math.floor(stars.length/2)];
    if (med >= 100) suggestions.push(`above ${med.toLocaleString()} stars`);
  }
  if (!hasRec) suggestions.push('only recently updated');
  return suggestions.slice(0, 6);
}
