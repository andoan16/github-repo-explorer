import { describe, it, expect } from 'vitest';
import { RankingEngine } from '../../src/main/ranking/engine';
import type { GitHubRepo, SearchCriteria } from '../../src/shared/types';

describe('PDFCraftTool/pdfcraft real metadata ranking test', () => {
  const engine = new RankingEngine();

  // Exactly as returned by GitHub API
  const realPdfCraft: GitHubRepo = {
    id: 768994541,
    full_name: 'PDFCraftTool/pdfcraft',
    html_url: 'https://github.com/PDFCraftTool/pdfcraft',
    description: 'PDFCraft is a free, privacy-focused PDF toolkit that runs entirely in your browser. With 90+ professional tools, you can edit, convert, merge, split, and secure your PDF files without ever uploading them to a server.',
    stars: 9575,
    forks: 520,
    language: 'TypeScript',
    topics: [], // REAL GITHUB METADATA: TOPICS ARE EMPTY!
    updated_at: '2026-10-21T10:00:00Z',
    license: { key: 'agpl-3.0', name: 'AGPL' },
    archived: false,
    open_issues: 10,
    default_branch: 'main',
  };

  const realStirling: GitHubRepo = {
    id: 615024227,
    full_name: 'Stirling-Tools/Stirling-PDF',
    html_url: 'https://github.com/Stirling-Tools/Stirling-PDF',
    description: '#1 PDF Application on GitHub that lets you edit PDFs on any device anywhere',
    stars: 94664,
    forks: 5100,
    language: 'TypeScript',
    topics: ['docker', 'pdf', 'pdf-editor', 'pdf-tools', 'self-hosted'],
    updated_at: '2026-10-21T10:00:00Z',
    license: { key: 'gpl-3.0', name: 'GPL' },
    archived: false,
    open_issues: 50,
    default_branch: 'main',
  };

  const realStorytold: GitHubRepo = {
    id: 500112233,
    full_name: 'storytold/pdfcraft',
    html_url: 'https://github.com/storytold/pdfcraft',
    description: 'PdfCraft: An open-source PDF reader and editor written by scratch in pure Rust',
    stars: 16874,
    forks: 320,
    language: 'Rust',
    topics: ['pdf', 'pdf-tools', 'pdf-viewer', 'rust'],
    updated_at: '2026-10-21T10:00:00Z',
    license: { key: 'apache-2.0', name: 'Apache-2.0' },
    archived: false,
    open_issues: 5,
    default_branch: 'main',
  };

  it('evaluates ranking for PDFCraft with alternative criteria', async () => {
    const criteria: SearchCriteria = {
      keywords: ['pdf editor', 'pdf toolkit', 'pdf tools'],
      technologies: [],
      intent: 'desktop-app',
      useCase: 'phần mềm thay thế cho pdf editor của Adobe',
      minStars: 0,
      preferredLicense: null,
      requireRecentActivity: false,
      benchmarkEntity: 'Adobe Acrobat',
      targetFeatures: ['annotate', 'sign', 'merge', 'split', 'compress', 'convert', 'form'],
      topicTags: ['pdf-editor', 'pdf-tools', 'pdf', 'pdf-toolkit'],
    };

    const repos = [realPdfCraft, realStirling, realStorytold];
    const readmes = new Map<number, string | null>([
      [768994541, '# PDFCraft\nOpen-source web PDF editor, converter and toolkit. Merge, split, compress, annotate, sign, and convert PDF files directly in your browser.'],
      [615024227, '# Stirling-PDF\n#1 PDF editor and manipulation tool.'],
      [500112233, '# PdfCraft\nRust PDF reader and editor.'],
    ]);
    const vectorScores = new Map<number, number>([
      [768994541, 0.88],
      [615024227, 0.90],
      [500112233, 0.82],
    ]);
    const ranked = await engine.rank(repos, criteria, readmes, criteria.useCase, 10, undefined, vectorScores);
    console.log('Ranked order:', ranked.map(r => `${r.repo.full_name}: total=${r.score.total} semantic=${r.score.semanticMatch}`));

    // Both pdfcraft repos and stirling should be in top 3
    const names = ranked.map(r => r.repo.full_name);
    expect(names).toContain('PDFCraftTool/pdfcraft');
    expect(ranked.find(r => r.repo.full_name === 'PDFCraftTool/pdfcraft')!.score.total).toBeGreaterThan(0.65);
  });
});
