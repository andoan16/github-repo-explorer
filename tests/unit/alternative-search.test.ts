import { describe, it, expect } from 'vitest';
import { detectAlternativeRequest } from '../../src/main/search/intent-decomposer';
import { RankingEngine } from '../../src/main/ranking/engine';
import type { GitHubRepo, SearchCriteria } from '../../src/shared/types';

describe('Intent Decomposition for Alternative Searches', () => {
  it('detects alternative request for Adobe PDF editor in Vietnamese', () => {
    const result = detectAlternativeRequest('phần mềm thay thế cho pdf editor của Adobe');
    expect(result.isAlternative).toBe(true);
    expect(result.benchmark).toBe('Adobe Acrobat');
    expect(result.cleanCoreDomain).toBe('pdf editor');
    expect(result.suggestedTopics).toContain('pdf-editor');
    expect(result.suggestedFeatures).toContain('annotate');
    expect(result.suggestedFeatures).toContain('sign');
    expect(result.suggestedFeatures).toContain('merge');
  });

  it('detects alternative request in English', () => {
    const result = detectAlternativeRequest('open source alternative to notion');
    expect(result.isAlternative).toBe(true);
    expect(result.benchmark).toBe('Notion');
    expect(result.cleanCoreDomain).toContain('knowledge base');
    expect(result.suggestedTopics).toContain('wiki');
  });

  it('detects alternative request for Slack or Jira', () => {
    const jiraRes = detectAlternativeRequest('thay thế jira');
    expect(jiraRes.isAlternative).toBe(true);
    expect(jiraRes.benchmark).toBe('Jira');

    const slackRes = detectAlternativeRequest('like slack but open source');
    expect(slackRes.isAlternative).toBe(true);
    expect(slackRes.benchmark).toBe('Slack');
  });
});

describe('Ranking Optimization for Alternative Tools', () => {
  const rankingEngine = new RankingEngine();

  const mockPdfCraft: GitHubRepo = {
    id: 1,
    full_name: 'PDFCraftTool/pdfcraft',
    html_url: 'https://github.com/PDFCraftTool/pdfcraft',
    description: 'Free, open-source, and privacy-focused PDF toolkit designed to run entirely client-side. Merge, split, compress, convert, annotate, sign, secure.',
    stars: 250,
    forks: 30,
    language: 'TypeScript',
    license: { key: 'mit', name: 'MIT' },
    updated_at: '2026-03-01T00:00:00Z',
    topics: ['pdf', 'pdf-editor', 'pdf-tools', 'open-source', 'wasm'],
    open_issues: 2,
    default_branch: 'main',
    archived: false,
  };

  const mockAdobeScript: GitHubRepo = {
    id: 2,
    full_name: 'adobe-tools/acrobat-script',
    html_url: 'https://github.com/adobe-tools/acrobat-script',
    description: 'Python helper script to convert documents via Adobe Acrobat Pro API.',
    stars: 1200,
    forks: 150,
    language: 'Python',
    license: { key: 'mit', name: 'MIT' },
    updated_at: '2023-01-01T00:00:00Z',
    topics: ['adobe', 'acrobat', 'pdf'],
    open_issues: 5,
    default_branch: 'master',
    archived: false,
  };

  const mockGenericPdfLib: GitHubRepo = {
    id: 3,
    full_name: 'mozilla/pdf.js',
    html_url: 'https://github.com/mozilla/pdf.js',
    description: 'PDF Reader in JavaScript',
    stars: 45000,
    forks: 9000,
    language: 'JavaScript',
    license: { key: 'apache-2.0', name: 'Apache-2.0' },
    updated_at: '2026-01-01T00:00:00Z',
    topics: ['pdf', 'javascript', 'viewer'],
    open_issues: 100,
    default_branch: 'master',
    archived: false,
  };

  it('ranks PDFCraft higher than Adobe script and generic library for PDF editor alternative query', async () => {
    const criteria: SearchCriteria = {
      keywords: ['pdf editor open-source', 'pdf toolkit annotate sign merge'],
      technologies: [],
      intent: 'desktop-app',
      useCase: 'phần mềm thay thế cho pdf editor của Adobe',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: true,
      benchmarkEntity: 'Adobe Acrobat',
      targetFeatures: ['annotate', 'sign', 'merge', 'split', 'compress'],
      topicTags: ['pdf-editor', 'pdf-tools'],
    };

    const candidates = [mockAdobeScript, mockGenericPdfLib, mockPdfCraft];
    const readmes = new Map<number, string | null>();

    const ranked = await rankingEngine.rank(
      candidates,
      criteria,
      readmes,
      'phần mềm thay thế cho pdf editor của Adobe',
      10,
    );

    // PDFCraft should be ranked #1
    expect(ranked[0].repo.full_name).toBe('PDFCraftTool/pdfcraft');
    expect(ranked[0].score.semanticMatch).toBeGreaterThan(ranked[1].score.semanticMatch);
  });
});
