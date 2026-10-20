import { mineNegativeSpace } from './src/main/search/result-stats.ts';

const mockRepos = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  full_name: `owner${i}/repo${i}`,
  html_url: '',
  description: `This is a generic description for repo ${i}. It is real-time and distributed. But maybe it lacks some specific keywords that we are looking for.`,
  stars: 100,
  forks: 10,
  language: 'TypeScript',
  license: { key: 'mit', name: 'MIT' },
  updated_at: '2024-01-01T00:00:00Z',
  topics: ['backend', 'distributed', 'real-time', 'api', 'framework'],
  open_issues: 5,
  default_branch: 'main',
  archived: false,
}));

const query = "Looking for a high-performance, real-time distributed system with strong consistency and low-latency and minimal dependencies, hopefully cross-platform and cloud-native.";

function runBenchmark() {
  const start = performance.now();
  const iterations = 10000;

  for (let i = 0; i < iterations; i++) {
    mineNegativeSpace(query, mockRepos, 50);
  }

  const end = performance.now();
  console.log(`Time taken for ${iterations} iterations: ${(end - start).toFixed(2)}ms`);
}

runBenchmark();
