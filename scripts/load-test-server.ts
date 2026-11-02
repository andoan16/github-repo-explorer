import http from 'http';
import { RankingEngine } from '../src/main/ranking/engine';
import { mineNegativeSpace, computeResultStatistics } from '../src/main/search/result-stats';
import { detectVietnamese, quickVietnameseTranslateStructured, normalizeVietnameseQuery } from '../src/main/search/vietnamese';
import type { GitHubRepo, SearchCriteria } from '../src/shared/types';

const rankingEngine = new RankingEngine();

// Mock repository database
const SAMPLE_REPOS: GitHubRepo[] = Array.from({ length: 80 }, (_, i) => ({
  id: 1000 + i,
  full_name: `org${i % 10}/repo-${i}`,
  html_url: `https://github.com/org${i % 10}/repo-${i}`,
  description: i % 2 === 0
    ? `High-performance real-time distributed system and database tool ${i}`
    : `Open-source web application framework and developer tools ${i}`,
  stars: 50 + (i * 350) % 50000,
  forks: 10 + (i * 45) % 8000,
  language: ['TypeScript', 'Go', 'Rust', 'Python', 'Java'][i % 5],
  license: { key: 'mit', name: 'MIT License' },
  updated_at: new Date(Date.now() - (i * 86400000 * 2)).toISOString(),
  topics: ['real-time', 'database', 'devtools', 'distributed', 'docker', 'api'],
  open_issues: 5 + (i % 20),
  default_branch: 'main',
  archived: false,
}));

// Mock README cache
const readmeCache = new Map<number, string>();
for (let i = 0; i < 40; i++) {
  readmeCache.set(1000 + i, `# Repository ${i}\n\nComprehensive documentation and benchmarks for repository ${i}. Includes instructions for deployment with Docker.`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  // Helper response
  const sendJson = (statusCode: number, data: any) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    // 1. Health check
    if (url.pathname === '/health') {
      return sendJson(200, { status: 'ok' });
    }

    // 2. Search Endpoint (Simulates Query Translation + Ranking + Negative Space Mining)
    if (method === 'POST' && url.pathname === '/api/search') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const query = parsed.query || 'distributed real-time database';

          // Simulate Vietnamese translation / normalization if applicable
          const isVi = detectVietnamese(query) >= 0.3;
          let effectiveQuery = query;
          if (isVi) {
            const normalized = normalizeVietnameseQuery(query);
            const structured = quickVietnameseTranslateStructured(normalized);
            effectiveQuery = structured?.translation || normalized;
          }

          const criteria: SearchCriteria = {
            intent: 'database',
            keywords: effectiveQuery.split(' ').slice(0, 3),
            technologies: ['TypeScript', 'Go'],
            minStars: parsed.minStars || 0,
            preferredLicense: 'mit',
            requireRecentActivity: false,
            useCase: query,
          };

          // Rank 80 repositories
          const ranked = await rankingEngine.rank(SAMPLE_REPOS, criteria, readmeCache, query, 20);

          // Negative space mining
          const negSpace = mineNegativeSpace(query, SAMPLE_REPOS, 20);

          sendJson(200, {
            query,
            effectiveQuery,
            isVietnamese: isVi,
            totalRanked: ranked.length,
            topResult: ranked[0]?.repo.full_name,
            negativeSpaceCount: negSpace.gaps.length,
          });
        } catch (e: any) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 3. Search Refinement Endpoint
    if (method === 'POST' && url.pathname === '/api/refine') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const sortKey = parsed.sortKey || 'stars';
          const desc = parsed.desc ?? true;

          const repos = [...SAMPLE_REPOS];
          repos.sort((a, b) => {
            if (sortKey === 'stars') return desc ? b.stars - a.stars : a.stars - b.stars;
            if (sortKey === 'forks') return desc ? b.forks - a.forks : a.forks - b.forks;
            return 0;
          });

          sendJson(200, {
            refinedCount: repos.length,
            topResult: repos[0]?.full_name,
            sortKey,
          });
        } catch (e: any) {
          sendJson(400, { error: e.message });
        }
      });
      return;
    }

    // 4. README Fetch Endpoint (Cache hit vs miss benchmark)
    if (method === 'GET' && url.pathname.startsWith('/api/readme/')) {
      const idStr = url.pathname.split('/').pop() || '';
      const repoId = parseInt(idStr, 10);
      const cached = readmeCache.get(repoId);

      if (cached) {
        return sendJson(200, { cached: true, readme: cached });
      }

      // Simulate a small network retrieval delay on cache miss
      setTimeout(() => {
        const generated = `# Generated README for ${repoId}\n\nRetrieved from GitHub API.`;
        readmeCache.set(repoId, generated);
        sendJson(200, { cached: false, readme: generated });
      }, 35);
      return;
    }

    // 404
    sendJson(404, { error: 'Not Found' });
  } catch (err: any) {
    sendJson(500, { error: err.message });
  }
});

const PORT = 3899;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Load test server listening on http://127.0.0.1:${PORT}`);
});
