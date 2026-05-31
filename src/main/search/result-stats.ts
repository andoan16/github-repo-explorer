import type { GitHubRepo } from '../../shared/types';

export interface ResultStatistics {
  /** Language breakdown: "Python (12 of 40, 30%)" sorted desc */
  languageDistribution: string;
  /** License breakdown: "MIT (24 of 40, 60%)" sorted desc */
  licenseDistribution: string;
  /** Star info: "120 — 34,000 (median 850)" */
  starRange: string;
  /** Top topic clusters: "monitoring (8), docker (6), prometheus (5)" */
  topTopics: string;
}

export interface NegativeSpace {
  /** Formatted summary for LLM prompt injection */
  summary: string;
  /** Keywords missing from results (individual entries with presence %) */
  gaps: { keyword: string; presence: number }[];
}

// Words too generic to be meaningful claim-words
const GENERIC_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of',
  'is', 'it', 'as', 'at', 'be', 'by', 'me', 'my', 'we', 'our', 'this',
  'that', 'i', 'you', 'he', 'she', 'they', 'do', 'does', 'can', 'will',
  'need', 'want', 'find', 'get', 'search', 'looking', 'something', 'like',
  'use', 'using', 'build', 'building', 'make', 'good', 'best', 'nice', 'great',
  'tool', 'project', 'projects', 'repo', 'library', 'framework', 'system', 'platform',
  'open', 'source', 'code', 'show', 'work', 'help', 'please', 'just',
  'also', 'would', 'could', 'should', 'one', 'any', 'all', 'some', 'many',
  'server', 'support', 'dashboard', 'with', 'type', 'based',
  'ci', 'cd', 'cicd', 'api', 'sdk', 'cli', 'ui', 'gui',
  'data', 'app', 'apps', 'web', 'tool', 'tools', 'service', 'services',
  'new', 'old', 'simple', 'easy', 'fast', 'small', 'large',
]);

// Qualifier phrases that carry specific intent and should be checked as units
const QUALIFIER_PATTERNS = [
  /real[-\s]?time/gi, /streaming/gi, /self[-\s]?hosted/gi,
  /on[-\s]?prem(?:ise)?/gi, /cloud[-\s]?(?:native|ready)?/gi,
  /serverless/gi, /distributed/gi, /offline[-\s]?first/gi,
  /cross[-\s]?platform/gi, /multi[-\s]?tenant/gi,
  /high[-\s]?performance/gi, /low[-\s]?latency/gi,
  /lightweight/gi, /minimal/gi, /production[-\s]?ready/gi,
  /enterprise[-\s]?(?:-grade)?/gi, /open[-\s]?source/gi,
];

/**
 * Computes statistics from the full result set for injection into the
 * LLM prompt. O(n) single-pass over the repo list.
 */
export function computeResultStatistics(repos: GitHubRepo[]): ResultStatistics {
  const total = repos.length;
  if (total === 0) {
    return {
      languageDistribution: 'N/A',
      licenseDistribution: 'N/A',
      starRange: 'N/A',
      topTopics: 'N/A',
    };
  }

  // ── Language distribution ──
  const langCount = new Map<string, number>();
  for (const r of repos) {
    if (r.language) {
      const lang = r.language;
      langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
    }
  }
  const sortedLangs = [...langCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  const languageDistribution = sortedLangs
    .map(([lang, count]) => `${lang} (${count} of ${total}, ${pct(count, total)}%)`)
    .join(', ');

  // ── License distribution ──
  const licenseCount = new Map<string, number>();
  for (const r of repos) {
    const licenseKey = r.license?.key ?? 'none';
    licenseCount.set(licenseKey, (licenseCount.get(licenseKey) ?? 0) + 1);
  }
  const sortedLicenses = [...licenseCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const licenseDistribution = sortedLicenses
    .map(([lic, count]) => `${lic} (${count} of ${total}, ${pct(count, total)}%)`)
    .join(', ');

  // ── Star range ──
  const stars = repos.map((r) => r.stars);
  const minStars = Math.min(...stars);
  const maxStars = Math.max(...stars);
  const sorted = [...stars].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const starRange = `${minStars.toLocaleString()} — ${maxStars.toLocaleString()} (median ${median.toLocaleString()})`;

  // ── Top topics ──
  const topicCount = new Map<string, number>();
  for (const r of repos) {
    for (const t of r.topics) {
      if (t) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
  }
  const topTopics = [...topicCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, c]) => `${t} (${c})`)
    .join(', ');

  return {
    languageDistribution,
    licenseDistribution,
    starRange,
    topTopics,
  };
}

/**
 * Mines the top-N repos for keywords from the query that are underrepresented.
 * Returns gaps where a query keyword has <20% presence in descriptions or topics.
 *
 * Uses two extraction strategies:
 * 1. Qualifier patterns — fixed phrases like "real-time", "self-hosted"
 * 2. Content words — significant nouns/tech terms from the query, minus generic words
 */
export function mineNegativeSpace(
  userRequest: string,
  repos: GitHubRepo[],
  topN: number = 10,
): NegativeSpace {
  if (repos.length === 0) {
    return { summary: '', gaps: [] };
  }

  const topRepos = repos.slice(0, Math.min(topN, repos.length));
  const lowerRequest = userRequest.toLowerCase();

  // ── Extract qualifier phrases ──
  const qualifiers: string[] = [];
  for (const pattern of QUALIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(lowerRequest)) !== null) {
      const normalized = match[0].replace(/[-\s]+/g, '-').toLowerCase();
      if (!qualifiers.includes(normalized)) {
        qualifiers.push(normalized);
      }
    }
  }

  // ── Extract content words ──
  const contentWords = lowerRequest
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w))
    // Deduplicate
    .filter((w, i, arr) => arr.indexOf(w) === i)
    // Exclude words already covered by qualifiers
    .filter((w) => !qualifiers.some((q) => q.includes(w) || w.includes(q)));

  // Combine: qualifiers first (they carry more intent), then content words
  const allClaims = [...qualifiers, ...contentWords].slice(0, 15);

  if (allClaims.length === 0) {
    return { summary: '', gaps: [] };
  }

  // ── Check presence in top repos ──
  const gaps: { keyword: string; presence: number }[] = [];

  for (const claim of allClaims) {
    let hits = 0;
    for (const repo of topRepos) {
      const desc = (repo.description ?? '').toLowerCase();
      const topics = repo.topics.map((t) => t.toLowerCase()).join(' ');
      const name = repo.full_name.toLowerCase();
      const searchTarget = `${desc} ${topics} ${name}`;

      if (searchTarget.includes(claim)) {
        hits++;
      }
    }
    const presence = Math.round((hits / topRepos.length) * 100);

    // Flag keywords with <20% presence
    if (presence < 20) {
      gaps.push({ keyword: claim, presence });
    }
  }

  // ── Build summary ──
  if (gaps.length === 0) {
    return { summary: '', gaps: [] };
  }

  const summary = gaps
    .map((g) => `"${g.keyword}" (${g.presence}%)`)
    .join(', ');

  return { summary, gaps };
}

function pct(count: number, total: number): number {
  return Math.round((count / total) * 100);
}
