import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom Metrics
export const failureRate = new Rate('failed_requests');
export const searchDuration = new Trend('search_duration');
export const refineDuration = new Trend('refine_duration');
export const readmeDuration = new Trend('readme_duration');

export const options = {
  // Simulating 50 Virtual Users with progressive ramp-up and steady state
  stages: [
    { duration: '10s', target: 50 }, // Ramp-up to 50 VUs
    { duration: '20s', target: 50 }, // Maintain 50 VUs steady load
    { duration: '5s', target: 0 },   // Ramp-down to 0
  ],
  thresholds: {
    // 95% of requests should be below 300ms, 99% below 600ms
    http_req_duration: ['p(95)<300', 'p(99)<600'],
    failed_requests: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:3899';

const SEARCH_QUERIES = [
  'high performance distributed database',
  'công cụ quản lý cơ sở dữ liệu thời gian thực',
  'real-time web framework with typescript',
  'hệ thống giám sát docker container tự động',
  'fast api gateway with load balancing',
  'thư viện xử lý hình ảnh và đồ họa vector',
];

export default function () {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const headers = { 'Content-Type': 'application/json' };

  group('1. Repository Search Pipeline', function () {
    const payload = JSON.stringify({
      query: query,
      minStars: Math.random() > 0.5 ? 500 : 0,
    });

    const res = http.post(`${BASE_URL}/api/search`, payload, { headers });
    searchDuration.add(res.timings.duration);

    const ok = check(res, {
      'search status 200': (r) => r.status === 200,
      'ranked repositories returned': (r) => {
        try {
          return JSON.parse(r.body).totalRanked > 0;
        } catch (_) {
          return false;
        }
      },
    });
    failureRate.add(!ok);
  });

  sleep(0.3);

  group('2. Search Refinement (Re-ranking)', function () {
    const sortKeys = ['stars', 'forks'];
    const sortKey = sortKeys[Math.floor(Math.random() * sortKeys.length)];
    const payload = JSON.stringify({
      sortKey: sortKey,
      desc: true,
    });

    const res = http.post(`${BASE_URL}/api/refine`, payload, { headers });
    refineDuration.add(res.timings.duration);

    const ok = check(res, {
      'refine status 200': (r) => r.status === 200,
      'has refined results': (r) => {
        try {
          return JSON.parse(r.body).refinedCount > 0;
        } catch (_) {
          return false;
        }
      },
    });
    failureRate.add(!ok);
  });

  sleep(0.2);

  group('3. README Retrieval (Cache & Fetch)', function () {
    // 70% chance of cached repoId (1000-1039), 30% chance of cache miss (1040-1079)
    const repoId = Math.random() < 0.7
      ? 1000 + Math.floor(Math.random() * 40)
      : 1040 + Math.floor(Math.random() * 40);

    const res = http.get(`${BASE_URL}/api/readme/${repoId}`);
    readmeDuration.add(res.timings.duration);

    const ok = check(res, {
      'readme status 200': (r) => r.status === 200,
      'readme content exists': (r) => {
        try {
          return JSON.parse(r.body).readme.length > 0;
        } catch (_) {
          return false;
        }
      },
    });
    failureRate.add(!ok);
  });

  sleep(0.5);
}

export function handleSummary(data) {
  return {
    'scripts/k6/summary.json': JSON.stringify(data, null, 2),
  };
}

