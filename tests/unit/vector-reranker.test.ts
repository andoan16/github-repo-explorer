import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorReranker, cosineSimilarity, computeTfIdfVector } from '../../src/main/ranking/vector-reranker';
import type { GitHubRepo } from '../../src/shared/types';

describe('VectorReranker - Cosine Similarity & TF-IDF', () => {
  it('computes exact cosine similarity for identical vectors', () => {
    const vecA = [1, 2, 3];
    const vecB = [1, 2, 3];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
  });

  it('computes 0 for orthogonal vectors', () => {
    const vecA = [1, 0];
    const vecB = [0, 1];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  it('handles empty or zero-magnitude vectors gracefully', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('extracts unigram and bigram features into TF-IDF vector', () => {
    const vocab = new Map<string, number>([
      ['pdf', 0],
      ['editor', 1],
      ['pdf_editor', 2],
    ]);
    const vec = computeTfIdfVector('pdf editor software', vocab);
    expect(vec[0]).toBe(1); // unigram pdf
    expect(vec[1]).toBe(1); // unigram editor
    expect(vec[2]).toBe(1.5); // bigram pdf_editor
  });
});

describe('VectorReranker - Candidate Reranking', () => {
  let reranker: VectorReranker;

  beforeEach(() => {
    // Provide non-existent model to test deterministic TF-IDF fallback path in unit tests
    reranker = new VectorReranker('/tmp/non-existent-embedding-model.gguf');
  });

  it('returns empty map when candidates are empty', async () => {
    const scores = await reranker.rerankCandidates('query', [], new Map());
    expect(scores.size).toBe(0);
  });

  it('scores repos based on semantic relevance to query', async () => {
    const repos: GitHubRepo[] = [
      {
        id: 1,
        full_name: 'PDFCraftTool/pdfcraft',
        html_url: '',
        description: 'PDFCraft is a free privacy-focused PDF toolkit that runs in browser with 90+ tools to edit, convert, merge, split',
        stars: 9540,
        forks: 100,
        language: 'TypeScript',
        topics: ['pdf-editor', 'pdf-tools', 'toolkit'],
        license: { key: 'agpl-3.0', name: 'AGPL' },
        updated_at: new Date().toISOString(),
        archived: false,
        open_issues: 5,
        default_branch: 'main',
      },
      {
        id: 2,
        full_name: 'unrelated/cat-scraper',
        html_url: '',
        description: 'Scrapes images of cute cats from websites',
        stars: 50,
        forks: 2,
        language: 'Python',
        topics: ['crawler', 'cats'],
        license: null,
        updated_at: new Date().toISOString(),
        archived: false,
        open_issues: 0,
        default_branch: 'main',
      },
    ];

    const readmes = new Map<number, string | null>([
      [1, '# PDFCraft\nOpen-source web PDF editor and toolkit for converting, editing, splitting PDF files.'],
      [2, '# Cat Scraper\nDownload cat photos.'],
    ]);

    const scores = await reranker.rerankCandidates('open source pdf editor and toolkit', repos, readmes);

    expect(scores.has(1)).toBe(true);
    expect(scores.has(2)).toBe(true);
    // PDFCraft should have significantly higher semantic similarity than cat scraper
    expect(scores.get(1)!).toBeGreaterThan(scores.get(2)!);
    expect(scores.get(1)!).toBeGreaterThan(0.4);
  });
});
