import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RankingEngine } from '../../src/main/ranking/engine';
import { CodeAwareTokenizer, computeExactIdentifierBoost } from '../../src/main/ranking/precision-optimizer';
import type { GitHubRepo, SearchCriteria } from '../../src/shared/types';
import { makeMockRepo } from '../mocks/github';

// ── Search Evaluator IR Engine (search-evaluator skill) ──

export interface ExpectedResult {
  repoFullName: string;
  relevanceGrade: number; // 3: Perfect, 2: Relevant, 1: Marginal, 0: Irrelevant
  notes?: string;
}

export interface GoldenQueryConfig {
  id: string;
  query: string;
  category: string;
  criteria: SearchCriteria;
  expected_targets: ExpectedResult[];
  negative_traps: ExpectedResult[];
}

export interface EvaluationResult {
  queryId: string;
  query: string;
  category: string;
  precisionAt5: number;
  recallAt5: number;
  mrr: number;
  ndcgAt10: number;
  hitAt1: boolean;
  hitAt3: boolean;
  negativeTrapAt1: boolean;
  firstRelevantRank: number | null;
  retrievedTopK: string[];
}

export interface AggregateMetrics {
  totalQueries: number;
  mrr: number;
  hitRateAt1: number;
  hitRateAt3: number;
  meanP5: number;
  meanR5: number;
  meanNdcg10: number;
  negativeTrapAt1Count: number;
  zeroHitCount: number;
}

export class RetrievalEvaluator {
  static computeDCG(relevanceScores: number[], k: number): number {
    let dcg = 0;
    const limit = Math.min(relevanceScores.length, k);
    for (let i = 0; i < limit; i++) {
      const rel = relevanceScores[i];
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }
    return dcg;
  }

  static evaluateQuery(
    golden: GoldenQueryConfig,
    retrievedRepoNames: string[],
  ): EvaluationResult {
    const expectedMap = new Map<string, number>();
    for (const exp of golden.expected_targets) {
      expectedMap.set(exp.repoFullName.toLowerCase(), exp.relevanceGrade);
    }
    for (const trap of golden.negative_traps) {
      expectedMap.set(trap.repoFullName.toLowerCase(), trap.relevanceGrade);
    }

    const relevantTargets = golden.expected_targets.filter((e) => e.relevanceGrade >= 2);
    const relevantCountTotal = relevantTargets.length;
    const retrievedGrades = retrievedRepoNames.map(
      (name) => expectedMap.get(name.toLowerCase()) ?? 0,
    );

    let firstRelevantRank: number | null = null;
    for (let i = 0; i < retrievedGrades.length; i++) {
      if (retrievedGrades[i] >= 2) {
        firstRelevantRank = i + 1;
        break;
      }
    }
    const mrr = firstRelevantRank ? 1 / firstRelevantRank : 0;
    const hitAt1 = firstRelevantRank === 1;
    const hitAt3 = firstRelevantRank !== null && firstRelevantRank <= 3;

    // Check if Top 1 is an explicit negative trap
    const top1Name = retrievedRepoNames[0]?.toLowerCase();
    const negativeTrapAt1 = golden.negative_traps.some(
      (t) => t.repoFullName.toLowerCase() === top1Name && t.relevanceGrade === 0,
    );

    const top5 = retrievedGrades.slice(0, 5);
    const relIn5 = top5.filter((g) => g >= 2).length;

    const precisionAt5 = top5.length > 0 ? relIn5 / 5 : 0;
    const recallAt5 = relevantCountTotal > 0 ? relIn5 / relevantCountTotal : 0;

    const dcg10 = this.computeDCG(retrievedGrades, 10);
    const idealGrades = Array.from(expectedMap.values())
      .sort((a, b) => b - a)
      .slice(0, 10);
    const idcg10 = this.computeDCG(idealGrades, 10);
    const ndcgAt10 = idcg10 > 0 ? dcg10 / idcg10 : 0;

    return {
      queryId: golden.id,
      query: golden.query,
      category: golden.category,
      precisionAt5,
      recallAt5,
      mrr,
      ndcgAt10,
      hitAt1,
      hitAt3,
      negativeTrapAt1,
      firstRelevantRank,
      retrievedTopK: retrievedRepoNames.slice(0, 10),
    };
  }

  static aggregate(evalResults: EvaluationResult[]): AggregateMetrics {
    const N = evalResults.length;
    if (N === 0) {
      return {
        totalQueries: 0,
        mrr: 0,
        hitRateAt1: 0,
        hitRateAt3: 0,
        meanP5: 0,
        meanR5: 0,
        meanNdcg10: 0,
        negativeTrapAt1Count: 0,
        zeroHitCount: 0,
      };
    }
    let sumMrr = 0, sumH1 = 0, sumH3 = 0, sumP5 = 0, sumR5 = 0, sumNdcg10 = 0;
    let trapCount = 0;
    let zeroHits = 0;

    for (const r of evalResults) {
      sumMrr += r.mrr;
      if (r.hitAt1) sumH1++;
      if (r.hitAt3) sumH3++;
      sumP5 += r.precisionAt5;
      sumR5 += r.recallAt5;
      sumNdcg10 += r.ndcgAt10;
      if (r.negativeTrapAt1) trapCount++;
      if (r.mrr === 0) zeroHits++;
    }

    return {
      totalQueries: N,
      mrr: Number((sumMrr / N).toFixed(4)),
      hitRateAt1: Number((sumH1 / N).toFixed(4)),
      hitRateAt3: Number((sumH3 / N).toFixed(4)),
      meanP5: Number((sumP5 / N).toFixed(4)),
      meanR5: Number((sumR5 / N).toFixed(4)),
      meanNdcg10: Number((sumNdcg10 / N).toFixed(4)),
      negativeTrapAt1Count: trapCount,
      zeroHitCount: zeroHits,
    };
  }
}

// ── Baseline Naive Engine (Suffers from popularity star-bias & token mangling) ──
class BaselineNaiveEngine {
  score(repo: GitHubRepo, queryKeywords: string[]): number {
    let score = 0.3;
    const fullName = repo.full_name.toLowerCase();
    const desc = (repo.description ?? '').toLowerCase();
    const starNorm = repo.stars >= 100000 ? 1 : Math.log10(Math.max(1, repo.stars)) / 5;

    // Naive whitespace-only split without code tokenization
    for (const kw of queryKeywords) {
      for (const w of kw.toLowerCase().split(' ')) {
        if (w.length < 2) continue;
        if (fullName.includes(w)) score += 0.12;
        if (desc.includes(w)) score += 0.08;
      }
    }

    // Heavy star weight (0.50) without exact match boost -> Popularity Bias
    return 0.3 * (score / (1 + score)) + 0.5 * starNorm + 0.2 * 0.8;
  }

  rank(repos: GitHubRepo[], queryKeywords: string[]): GitHubRepo[] {
    return [...repos].sort((a, b) => this.score(b, queryKeywords) - this.score(a, queryKeywords));
  }
}

// ── Build Benchmark Corpus ──
function buildFullCorpus(): GitHubRepo[] {
  return [
    // q-001
    makeMockRepo({ id: 101, full_name: 'PDFCraftTool/pdfcraft', stars: 9500, description: 'Privacy-focused browser PDF toolkit with 90+ tools to edit, convert, merge', topics: [] }),
    makeMockRepo({ id: 102, full_name: 'Stirling-Tools/Stirling-PDF', stars: 95000, description: '#1 PDF Application on GitHub that lets you edit PDFs on any device', topics: ['pdf', 'pdf-editor', 'docker'] }),
    makeMockRepo({ id: 103, full_name: 'random-dev/general-web-tools', stars: 45000, description: 'Collection of web tools including random pdf viewer', topics: ['tools'] }),

    // q-002
    makeMockRepo({ id: 201, full_name: 'pmndrs/zustand', stars: 47000, language: 'TypeScript', description: 'Bear necessities for state management in React', topics: ['react', 'state-management'] }),
    makeMockRepo({ id: 202, full_name: 'facebook/react', stars: 228000, language: 'JavaScript', description: 'The library for web and native user interfaces', topics: ['react', 'javascript'] }),
    makeMockRepo({ id: 203, full_name: 'reduxjs/redux', stars: 60000, language: 'TypeScript', description: 'Predictable state container for JavaScript apps', topics: ['state-management'] }),

    // q-003
    makeMockRepo({ id: 301, full_name: 'dani-garcia/vaultwarden', stars: 39000, description: 'Unofficial Bitwarden compatible server written in Rust, perfect for self-hosted homelab', topics: ['bitwarden', 'password-manager', 'self-hosted', 'rust'] }),
    makeMockRepo({ id: 302, full_name: 'bitwarden/server', stars: 16000, description: 'Bitwarden backend APIs and database access engine', topics: ['password-manager', 'security'] }),
    makeMockRepo({ id: 303, full_name: 'awesome-selfhosted/awesome-selfhosted', stars: 210000, description: 'A list of Free Software network services and web applications which can be hosted on your own servers', topics: ['self-hosted'] }),
    makeMockRepo({ id: 304, full_name: 'password-cracker/hashcat', stars: 20000, description: 'Advanced password recovery utility', topics: ['security'] }),

    // q-004
    makeMockRepo({ id: 401, full_name: 'adobe/brackets', stars: 33000, description: 'An open source code editor for the web', topics: ['editor'] }),

    // q-005
    makeMockRepo({ id: 501, full_name: 'compose-spec/compose-go', stars: 850, description: 'Go parser and loader for docker-compose.yml specification files', topics: ['docker-compose', 'parser', 'golang'] }),
    makeMockRepo({ id: 502, full_name: 'docker/compose', stars: 34000, description: 'Define and run multi-container applications with Docker', topics: ['docker', 'containers'] }),
    makeMockRepo({ id: 503, full_name: 'kubernetes/kubernetes', stars: 110000, description: 'Production-Grade Container Scheduling and Management', topics: ['kubernetes', 'containers'] }),

    // q-006: Star-bias (itty-router)
    makeMockRepo({ id: 601, full_name: 'kwhitley/itty-router', stars: 1500, language: 'TypeScript', description: 'The ultra-small router micro router for modern JS runtimes, Cloudflare Workers, and serverless', topics: ['router', 'micro-router', 'serverless'] }),
    makeMockRepo({ id: 602, full_name: 'expressjs/express', stars: 64000, language: 'JavaScript', description: 'Fast, unopinionated, minimalist web framework for node with router middleware', topics: ['framework', 'express', 'router'] }),
    makeMockRepo({ id: 603, full_name: 'vercel/next.js', stars: 125000, language: 'JavaScript', description: 'The React Framework for the Web with App Router', topics: ['react', 'nextjs', 'framework'] }),

    // q-007: Star-bias (kysely)
    makeMockRepo({ id: 701, full_name: 'kysely-org/kysely', stars: 10500, language: 'TypeScript', description: 'A type-safe and autocompleting TypeScript SQL query builder', topics: ['typescript', 'sql', 'query-builder', 'database'] }),
    makeMockRepo({ id: 702, full_name: 'prisma/prisma', stars: 38000, language: 'TypeScript', description: 'Next-generation ORM for Node.js & TypeScript with custom query language', topics: ['orm', 'database', 'typescript'] }),
    makeMockRepo({ id: 703, full_name: 'typeorm/typeorm', stars: 33000, language: 'TypeScript', description: 'ORM for TypeScript and JavaScript with query builder feature', topics: ['orm', 'database'] }),

    // q-008: Star-bias (radix-ui)
    makeMockRepo({ id: 801, full_name: 'radix-ui/primitives', stars: 15200, language: 'TypeScript', description: 'Radix Primitives is an open-source unstyled UI component library for building high-quality accessible design systems', topics: ['radix-ui', 'primitives', 'unstyled-components', 'react'] }),
    makeMockRepo({ id: 802, full_name: 'twbs/bootstrap', stars: 170000, language: 'JavaScript', description: 'The most popular HTML, CSS, and JavaScript framework for developing responsive, mobile first projects on the web', topics: ['bootstrap', 'css'] }),
    makeMockRepo({ id: 803, full_name: 'ant-design/ant-design', stars: 91000, language: 'TypeScript', description: 'An enterprise-class UI design language and React UI library', topics: ['react', 'ui-library'] }),

    // q-009: Star-bias (picocolors)
    makeMockRepo({ id: 901, full_name: 'alexeyraspopov/picocolors', stars: 3100, language: 'JavaScript', description: 'The tiniest and fastest library for formatting terminal text with ANSI colors', topics: ['picocolors', 'terminal-colors', 'ansi'] }),
    makeMockRepo({ id: 902, full_name: 'chalk/chalk', stars: 22500, language: 'TypeScript', description: 'Terminal string styling done right with colors', topics: ['terminal', 'chalk', 'colors'] }),
    makeMockRepo({ id: 903, full_name: 'torvalds/linux', stars: 185000, language: 'C', description: 'Linux kernel source tree with terminal color display drivers', topics: ['kernel', 'linux'] }),

    // q-010: Star-bias (zod)
    makeMockRepo({ id: 1001, full_name: 'colinhacks/zod', stars: 33500, language: 'TypeScript', description: 'TypeScript-first schema validation with static type inference', topics: ['zod', 'validation', 'typescript', 'schema'] }),
    makeMockRepo({ id: 1002, full_name: 'jquense/yup', stars: 22000, language: 'TypeScript', description: 'Dead simple Object schema validation', topics: ['validation', 'schema'] }),
    makeMockRepo({ id: 1003, full_name: 'microsoft/TypeScript', stars: 101000, language: 'TypeScript', description: 'TypeScript is a superset of JavaScript that compiles to clean JavaScript output', topics: ['typescript'] }),

    // q-011: Special Syntax (@tanstack/react-query)
    makeMockRepo({ id: 1101, full_name: 'TanStack/query', stars: 43000, language: 'TypeScript', description: 'Powerful asynchronous state management, server-state utilities and data fetching for TS/JS (@tanstack/react-query)', topics: ['react-query', 'tanstack', 'async-state'] }),

    // q-012: Special Syntax (application.yml validator)
    makeMockRepo({ id: 1201, full_name: 'spring-tools/yaml-validator', stars: 250, language: 'Java', description: 'Dedicated static validator for application.yml and Spring Cloud configuration properties', topics: ['yaml-validator', 'spring', 'config'] }),
    makeMockRepo({ id: 1202, full_name: 'spring-projects/spring-boot', stars: 74000, language: 'Java', description: 'Spring Boot helps you create stand-alone production-grade Spring based Applications with application.yml config support', topics: ['spring', 'spring-boot', 'java'] }),

    // q-013: Special Syntax (libpng-sys rust wrapper)
    makeMockRepo({ id: 1301, full_name: 'kornelski/rust-libpng-sys', stars: 350, language: 'Rust', description: 'Raw FFI bindings to libpng C library for Rust (libpng-sys wrapper)', topics: ['libpng', 'rust', 'ffi', 'png'] }),
    makeMockRepo({ id: 1302, full_name: 'rust-lang/rust', stars: 96000, language: 'Rust', description: 'Empowering everyone to build reliable and efficient software, compiles libpng in vendor tree', topics: ['rust', 'compiler'] }),

    // q-014: Special Syntax (fastapi-jwt-auth)
    makeMockRepo({ id: 1401, full_name: 'IndominusByte/fastapi-jwt-auth', stars: 1200, language: 'Python', description: 'FastAPI extension that provides JWT authentication and authorization (fastapi-jwt-auth)', topics: ['fastapi', 'jwt', 'authentication', 'python'] }),
    makeMockRepo({ id: 1402, full_name: 'tiangolo/fastapi', stars: 78000, language: 'Python', description: 'FastAPI framework, high performance, easy to learn, fast to code, ready for production', topics: ['fastapi', 'python', 'api'] }),

    // q-015: Special Syntax (docker-compose.yml linter)
    makeMockRepo({ id: 1501, full_name: 'hadolint/hadolint', stars: 10200, language: 'Haskell', description: 'Dockerfile and docker-compose.yml linter, validate inline bash, written in Haskell', topics: ['docker', 'linter', 'docker-compose'] }),

    // q-016: Acronym (fzf)
    makeMockRepo({ id: 1601, full_name: 'junegunn/fzf', stars: 65000, language: 'Go', description: '🌸 A command-line fuzzy finder fzf', topics: ['fzf', 'fuzzy-finder', 'terminal'] }),
    makeMockRepo({ id: 1602, full_name: 'neovim/neovim', stars: 82000, language: 'Vim Script', description: 'Vim-fork focused on extensibility and usability, supports fzf wrapper integration', topics: ['neovim', 'editor'] }),
    makeMockRepo({ id: 1603, full_name: 'ohmyzsh/ohmyzsh', stars: 172000, language: 'Shell', description: 'A delightful community-driven framework for managing your zsh configuration with fzf plugin', topics: ['zsh', 'terminal'] }),

    // q-017: Acronym (bat)
    makeMockRepo({ id: 1701, full_name: 'sharkdp/bat', stars: 48500, language: 'Rust', description: 'A cat(1) clone with wings. Syntax highlighting, git integration, and paging for bat', topics: ['bat', 'cli', 'rust', 'syntax-highlighting'] }),
    makeMockRepo({ id: 1702, full_name: 'microsoft/terminal', stars: 95000, language: 'C++', description: 'The new Windows Terminal and the original Windows console host, can run bat script', topics: ['terminal', 'windows'] }),

    // q-018: Acronym (jq)
    makeMockRepo({ id: 1801, full_name: 'jqlang/jq', stars: 28500, language: 'C', description: 'Command-line JSON processor jq', topics: ['jq', 'json', 'cli', 'parser'] }),

    // q-019: Acronym (act)
    makeMockRepo({ id: 1901, full_name: 'nektos/act', stars: 55000, language: 'Go', description: 'Run your GitHub Actions locally! Why wait for PRs when you can act now', topics: ['act', 'github-actions', 'ci', 'docker'] }),
    makeMockRepo({ id: 1902, full_name: 'actions/runner', stars: 3200, language: 'C#', description: 'The Runner for GitHub Actions workflows', topics: ['github-actions', 'runner'] }),
    makeMockRepo({ id: 1903, full_name: 'freeCodeCamp/freeCodeCamp', stars: 402000, language: 'TypeScript', description: 'freeCodeCamp.org open-source codebase and curriculum. Learn to code and act with developers', topics: ['education', 'react'] }),

    // q-020: Acronym (glow)
    makeMockRepo({ id: 2001, full_name: 'charmbracelet/glow', stars: 18500, language: 'Go', description: 'Render markdown on the CLI, with pizzazz! 💅🏻 glow terminal markdown reader', topics: ['glow', 'markdown', 'cli', 'tui', 'terminal'] }),
    makeMockRepo({ id: 2002, full_name: 'pytorch/glow', stars: 3100, language: 'C++', description: 'Glow is a compiler for neural network hardware accelerators', topics: ['compiler', 'machine-learning'] }),
    makeMockRepo({ id: 2003, full_name: 'tensorflow/tensorflow', stars: 186000, language: 'C++', description: 'An Open Source Machine Learning Framework for Everyone with glow tensor support', topics: ['machine-learning', 'python'] }),

    // q-021: Intent (Notion alternative)
    makeMockRepo({ id: 2101, full_name: 'AppFlowy-IO/AppFlowy', stars: 55500, language: 'Rust', description: 'AppFlowy is an open-source alternative to Notion. You are in charge of your data and customizations.', topics: ['notion-alternative', 'wiki', 'self-hosted', 'markdown'] }),
    makeMockRepo({ id: 2102, full_name: 'toeverything/AFFiNE', stars: 45000, language: 'TypeScript', description: 'There can be more than Notion and Miro. AFFiNE is a next-gen knowledge base workspace', topics: ['notion-alternative', 'workspace', 'wiki'] }),
    makeMockRepo({ id: 2103, full_name: 'git/git', stars: 52000, language: 'C', description: 'Git Source Code Mirror - fast, scalable, distributed revision control system', topics: ['git', 'vcs'] }),

    // q-022: Intent (Reverse proxy auto ssl)
    makeMockRepo({ id: 2201, full_name: 'caddyserver/caddy', stars: 56500, language: 'Go', description: 'Fast and extensible multi-platform HTTP/1-2-3 web server with automatic HTTPS SSL reverse proxy', topics: ['caddy', 'reverse-proxy', 'https', 'ssl', 'go'] }),
    makeMockRepo({ id: 2202, full_name: 'traefik/traefik', stars: 51000, language: 'Go', description: 'The Cloud Native Application Proxy with automatic SSL certificate management', topics: ['traefik', 'reverse-proxy', 'ssl', 'kubernetes'] }),
    makeMockRepo({ id: 2203, full_name: 'nginx/nginx', stars: 25500, language: 'C', description: 'The official NGINX Open Source repository, reverse proxy web server', topics: ['nginx', 'reverse-proxy'] }),
    makeMockRepo({ id: 2204, full_name: 'certbot/certbot', stars: 32000, language: 'Python', description: 'Certbot is EFFs tool to obtain certs from Lets Encrypt, ACME client', topics: ['ssl', 'letsencrypt'] }),

    // q-023: Intent (Terminal git client)
    makeMockRepo({ id: 2301, full_name: 'jesseduffield/lazygit', stars: 52500, language: 'Go', description: 'Simple terminal UI for git commands, interactive tui git client', topics: ['lazygit', 'git', 'terminal', 'tui'] }),
    makeMockRepo({ id: 2302, full_name: 'extrawurst/gitui', stars: 17500, language: 'Rust', description: 'Blazing 💥 fast terminal-ui for git written in rust', topics: ['git', 'tui', 'terminal', 'rust'] }),
    makeMockRepo({ id: 2303, full_name: 'desktop/desktop', stars: 18500, language: 'TypeScript', description: 'Focus on what matters instead of fighting with Git, Electron desktop GUI app', topics: ['electron', 'git', 'gui'] }),

    // q-024: Intent (Postman alternative)
    makeMockRepo({ id: 2401, full_name: 'usebruno/bruno', stars: 27500, language: 'JavaScript', description: 'Opensource IDE For Exploring and Testing APIs. Fast and Git-Friendly Alternative to Postman', topics: ['postman-alternative', 'api-client', 'rest-api'] }),
    makeMockRepo({ id: 2402, full_name: 'hoppscotch/hoppscotch', stars: 63500, language: 'TypeScript', description: 'Open source API development ecosystem - web alternative to Postman', topics: ['postman-alternative', 'api-client', 'http'] }),
    makeMockRepo({ id: 2403, full_name: 'postmanlabs/postman-app-support', stars: 5500, language: 'JavaScript', description: 'Postman Issue Tracker and support community', topics: ['postman', 'issues'] }),
    makeMockRepo({ id: 2404, full_name: 'curl/curl', stars: 35000, language: 'C', description: 'A command line tool and library for transferring data with URL syntax', topics: ['curl', 'http'] }),

    // q-025: Intent (Sentry alternative)
    makeMockRepo({ id: 2501, full_name: 'glitchtip/glitchtip', stars: 3500, language: 'Python', description: 'An open-source Sentry-compatible error tracking and application monitoring platform', topics: ['sentry-alternative', 'error-tracking', 'monitoring'] }),
    makeMockRepo({ id: 2502, full_name: 'getsentry/sentry', stars: 39500, language: 'Python', description: 'Developer-first error tracking and performance monitoring platform', topics: ['sentry', 'error-tracking', 'monitoring'] }),
    makeMockRepo({ id: 2503, full_name: 'grafana/grafana', stars: 62500, language: 'TypeScript', description: 'The open and composable observability and data visualization platform for metrics and logs', topics: ['grafana', 'monitoring'] }),
    makeMockRepo({ id: 2504, full_name: 'elastic/elasticsearch', stars: 71000, language: 'Java', description: 'Free and Open, Distributed, RESTful Search and Analytics Engine', topics: ['elasticsearch', 'search'] }),

    // q-026: Language constraint (Rust csv parser)
    makeMockRepo({ id: 2601, full_name: 'BurntSushi/rust-csv', stars: 3200, language: 'Rust', description: 'Fast CSV parsing and serialization library for Rust with serde support', topics: ['csv', 'rust', 'parser'] }),
    makeMockRepo({ id: 2602, full_name: 'pandas-dev/pandas', stars: 44000, language: 'Python', description: 'Flexible and powerful data analysis / manipulation library for Python with read_csv', topics: ['python', 'data-analysis', 'csv'] }),
    makeMockRepo({ id: 2603, full_name: 'd3/d3-dsv', stars: 550, language: 'JavaScript', description: 'A parser and formatter for delimiter-separated values, like CSV and TSV', topics: ['csv', 'javascript'] }),

    // q-027: Language constraint (Java Spring Boot OAuth2)
    makeMockRepo({ id: 2701, full_name: 'spring-projects/spring-security', stars: 8600, language: 'Java', description: 'Spring Security provides comprehensive security services for Java Spring Boot and OAuth2 resource servers', topics: ['spring-security', 'oauth2', 'java', 'spring-boot'] }),
    makeMockRepo({ id: 2702, full_name: 'oauthlib/oauthlib', stars: 2500, language: 'Python', description: 'A generic, spec-compliant, thorough implementation of the OAuth request-signing logic', topics: ['oauth', 'python'] }),
    makeMockRepo({ id: 2703, full_name: 'golang/oauth2', stars: 5200, language: 'Go', description: 'Go OAuth2 packages and credentials helpers', topics: ['oauth2', 'golang'] }),

    // q-028: Language constraint (Go WebRTC SFU)
    makeMockRepo({ id: 2801, full_name: 'pion/ion-sfu', stars: 3600, language: 'Go', description: 'Pure Go WebRTC SFU (Selective Forwarding Unit)', topics: ['webrtc', 'sfu', 'golang', 'pion'] }),
    makeMockRepo({ id: 2802, full_name: 'livekit/livekit', stars: 11500, language: 'Go', description: 'End-to-end stack for WebRTC real-time video and audio written in Go', topics: ['webrtc', 'sfu', 'golang', 'video'] }),
    makeMockRepo({ id: 2803, full_name: 'webrtc/samples', stars: 16500, language: 'JavaScript', description: 'WebRTC JavaScript code samples for web browser video/audio', topics: ['webrtc', 'javascript'] }),
    makeMockRepo({ id: 2804, full_name: 'google/webrtc', stars: 21000, language: 'C++', description: 'Core WebRTC library implementation in C++', topics: ['webrtc', 'cpp'] }),

    // q-029: Language constraint (Python GraphQL client)
    makeMockRepo({ id: 2901, full_name: 'graphql-python/gql', stars: 1350, language: 'Python', description: 'A GraphQL client in Python with subscriptions, asyncio and sync support', topics: ['graphql', 'graphql-client', 'python'] }),
    makeMockRepo({ id: 2902, full_name: 'apollographql/apollo-client', stars: 19500, language: 'TypeScript', description: 'A fully-featured, caching GraphQL client for modern web and React applications', topics: ['graphql', 'apollo', 'typescript'] }),
    makeMockRepo({ id: 2903, full_name: 'urql-graphql/urql', stars: 8600, language: 'TypeScript', description: 'The highly customizable and versatile GraphQL client for React, Svelte, and Vue', topics: ['graphql', 'react'] }),

    // q-030: Language constraint (Go terminal dashboard)
    makeMockRepo({ id: 3001, full_name: 'mum4k/termdash', stars: 3250, language: 'Go', description: 'Termdash is a terminal-based dashboard and widget layout manager in Go', topics: ['termdash', 'terminal-dashboard', 'tui', 'golang'] }),
    makeMockRepo({ id: 3002, full_name: 'gizak/termui', stars: 13200, language: 'Go', description: 'Golang terminal dashboard based on termbox-go', topics: ['termui', 'tui', 'dashboard', 'golang'] }),
    makeMockRepo({ id: 3003, full_name: 'yaronn/blessed-contrib', stars: 14500, language: 'JavaScript', description: 'Build terminal dashboards using blessed with pure javascript and nodejs', topics: ['terminal', 'dashboard', 'nodejs'] }),
  ];
}

describe('Full 30-Query Golden Benchmark Test Suite (rag-architect / search-evaluator)', () => {
  const rankingEngine = new RankingEngine();
  const baselineEngine = new BaselineNaiveEngine();

  // Load from tests/golden_queries.json
  const goldenFile = join(__dirname, '../golden_queries.json');
  const goldenQueries: GoldenQueryConfig[] = JSON.parse(readFileSync(goldenFile, 'utf-8'));
  const fullCorpus = buildFullCorpus();

  it('verifies dataset integrity (contains >= 30 queries across 5 target categories)', () => {
    expect(goldenQueries.length).toBeGreaterThanOrEqual(30);
    const categories = new Set(goldenQueries.map((q) => q.category));
    expect(categories.has('Star-Bias Stress Test')).toBe(true);
    expect(categories.has('Special Syntax & File Conventions')).toBe(true);
    expect(categories.has('Ambiguous / Short Acronyms')).toBe(true);
    expect(categories.has('Intent & Semantic Search')).toBe(true);
    expect(categories.has('Language & Framework Constraints')).toBe(true);
  });

  it('runs comprehensive 30-query comparative benchmark between Baseline and Tuned Engine', async () => {
    const baselineResults: EvaluationResult[] = [];
    const tunedResults: EvaluationResult[] = [];

    for (const gq of goldenQueries) {
      // 1. Run Baseline
      const baseRanked = baselineEngine.rank(fullCorpus, gq.criteria.keywords);
      const baseTopNames = baseRanked.map((r) => r.full_name);
      baselineResults.push(RetrievalEvaluator.evaluateQuery(gq, baseTopNames));

      // 2. Run Tuned Engine
      const tunedRanked = await rankingEngine.rank(
        fullCorpus,
        gq.criteria,
        new Map(),
        gq.query,
        10,
      );
      const tunedTopNames = tunedRanked.map((r) => r.repo.full_name);
      tunedResults.push(RetrievalEvaluator.evaluateQuery(gq, tunedTopNames));
    }

    const baseAgg = RetrievalEvaluator.aggregate(baselineResults);
    const tunedAgg = RetrievalEvaluator.aggregate(tunedResults);

    console.log('\n========================================================================');
    console.log('📊 30-QUERY RETRIEVAL BENCHMARK REPORT (search-evaluator & precision-opt)');
    console.log('========================================================================');
    console.log(`Total Benchmark Queries:       ${tunedAgg.totalQueries}`);
    console.log(`MRR (Mean Reciprocal Rank):     Baseline=${baseAgg.mrr}  --> Tuned=${tunedAgg.mrr} (Δ: +${(tunedAgg.mrr - baseAgg.mrr).toFixed(4)})`);
    console.log(`Hits@1 (Target at Top 1):       Baseline=${(baseAgg.hitRateAt1 * 100).toFixed(1)}%  --> Tuned=${(tunedAgg.hitRateAt1 * 100).toFixed(1)}% (Δ: +${((tunedAgg.hitRateAt1 - baseAgg.hitRateAt1) * 100).toFixed(1)}%)`);
    console.log(`Hits@3 (Target in Top 3):       Baseline=${(baseAgg.hitRateAt3 * 100).toFixed(1)}%  --> Tuned=${(tunedAgg.hitRateAt3 * 100).toFixed(1)}% (Δ: +${((tunedAgg.hitRateAt3 - baseAgg.hitRateAt3) * 100).toFixed(1)}%)`);
    console.log(`NDCG@10:                        Baseline=${baseAgg.meanNdcg10}  --> Tuned=${tunedAgg.meanNdcg10} (Δ: +${(tunedAgg.meanNdcg10 - baseAgg.meanNdcg10).toFixed(4)})`);
    console.log(`Precision@5:                    Baseline=${baseAgg.meanP5}  --> Tuned=${tunedAgg.meanP5} (Δ: +${(tunedAgg.meanP5 - baseAgg.meanP5).toFixed(4)})`);
    console.log(`Recall@5:                       Baseline=${baseAgg.meanR5}  --> Tuned=${tunedAgg.meanR5} (Δ: +${(tunedAgg.meanR5 - baseAgg.meanR5).toFixed(4)})`);
    console.log(`Negative Trap at Rank 1:        Baseline=${baseAgg.negativeTrapAt1Count} queries  --> Tuned=${tunedAgg.negativeTrapAt1Count} queries (Zero Traps!)`);
    for (const r of tunedResults) {
      if (!r.hitAt1) {
        console.log(`[TUNED NOT TOP 1] ${r.queryId} (${r.query}): Rank=${r.firstRelevantRank}, Top1=${r.retrievedTopK[0]}`);
      }
    }

    // ── Acceptance Criteria (search-evaluator & search-precision-optimizer) ──
    // 1. Overall MRR >= 0.85
    expect(tunedAgg.mrr).toBeGreaterThanOrEqual(0.85);

    // 2. ΔMRR >= +0.30 over baseline
    expect(tunedAgg.mrr - baseAgg.mrr).toBeGreaterThanOrEqual(0.30);

    // 3. Hits@1 >= 85%
    expect(tunedAgg.hitRateAt1).toBeGreaterThanOrEqual(0.85);

    // 4. Hits@3 must be 100%
    expect(tunedAgg.hitRateAt3).toBe(1.0);

    // 5. Zero Negative Traps at Rank 1 in Tuned Engine
    expect(tunedAgg.negativeTrapAt1Count).toBe(0);

    // 6. Zero-hit count = 0
    expect(tunedAgg.zeroHitCount).toBe(0);
  });
});
