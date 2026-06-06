import { describe, it, expect } from 'vitest';

// ── Inline copies of the rewrite functions from RepoDetail.tsx ──
// These are pure functions with no React dependency, so we replicate
// the logic here for unit testing.

function rewriteRelativeImageUrls(markdown: string, owner: string, repo: string, branch: string): string {
  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      if (/^(https?:\/\/|data:|#)/i.test(url)) return match;
      const cleanUrl = url.replace(/^\.\//, '');
      return `![${alt}](${baseUrl}/${cleanUrl})`;
    },
  );
}

function rewriteRelativeHtmlImgSrcs(html: string, owner: string, repo: string, branch: string): string {
  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
  return html.replace(
    /(<img\s[^>]*src=["'])([^"']+)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      if (/^(https?:\/\/|data:|#|\/\/)/i.test(src)) return match;
      const cleanSrc = src.replace(/^\.\//, '');
      return `${prefix}${baseUrl}/${cleanSrc}${suffix}`;
    },
  );
}

describe('rewriteRelativeImageUrls', () => {
  const BASE = 'https://raw.githubusercontent.com/owner/repo/main';

  it('rewrites bare relative paths', () => {
    const md = '![logo](images/logo.png)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main'))
      .toBe(`![logo](${BASE}/images/logo.png)`);
  });

  it('rewrites ./ prefix relative paths', () => {
    const md = '![diagram](./docs/arch.png)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main'))
      .toBe(`![diagram](${BASE}/docs/arch.png)`);
  });

  it('rewrites nested relative paths', () => {
    const md = '![screenshot](assets/img/screenshot.png)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main'))
      .toBe(`![screenshot](${BASE}/assets/img/screenshot.png)`);
  });

  it('leaves absolute https URLs unchanged', () => {
    const md = '![badge](https://img.shields.io/badge/test-passing-green)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main')).toBe(md);
  });

  it('leaves absolute http URLs unchanged', () => {
    const md = '![img](http://example.com/img.png)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main')).toBe(md);
  });

  it('leaves data URIs unchanged', () => {
    const md = '![icon](data:image/svg+xml;base64,PHN2Zz4=)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main')).toBe(md);
  });

  it('leaves anchor-only links unchanged', () => {
    const md = '![top](#top)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main')).toBe(md);
  });

  it('rewrites multiple images in one document', () => {
    const md = 'Intro\n\n![logo](./img/logo.png)\n\nSome text\n\n![diagram](docs/arch.svg)\n\nEnd';
    const result = rewriteRelativeImageUrls(md, 'owner', 'repo', 'main');
    expect(result).toContain(`${BASE}/img/logo.png`);
    expect(result).toContain(`${BASE}/docs/arch.svg`);
  });

  it('uses the correct branch name', () => {
    const md = '![img](pic.png)';
    const result = rewriteRelativeImageUrls(md, 'owner', 'repo', 'develop');
    expect(result).toBe('![img](https://raw.githubusercontent.com/owner/repo/develop/pic.png)');
  });

  it('handles empty alt text', () => {
    const md = '![](./img/pic.png)';
    expect(rewriteRelativeImageUrls(md, 'owner', 'repo', 'main'))
      .toBe(`![](${BASE}/img/pic.png)`);
  });
});

describe('rewriteRelativeHtmlImgSrcs', () => {
  const BASE = 'https://raw.githubusercontent.com/owner/repo/main';

  it('rewrites relative src in HTML img tags', () => {
    const html = '<img src="images/logo.png" alt="logo">';
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main'))
      .toBe(`<img src="${BASE}/images/logo.png" alt="logo">`);
  });

  it('rewrites relative src with ./ prefix', () => {
    const html = '<img src="./assets/diagram.svg" alt="diagram">';
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main'))
      .toBe(`<img src="${BASE}/assets/diagram.svg" alt="diagram">`);
  });

  it('leaves absolute https URLs unchanged', () => {
    const html = '<img src="https://cdn.example.com/img.png" alt="badge">';
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main')).toBe(html);
  });

  it('leaves protocol-relative URLs unchanged', () => {
    const html = '<img src="//cdn.example.com/img.png" alt="badge">';
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main')).toBe(html);
  });

  it('leaves data URIs unchanged', () => {
    const html = '<img src="data:image/png;base64,abc123" alt="icon">';
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main')).toBe(html);
  });

  it('handles single-quoted src', () => {
    const html = "<img src='docs/pic.png' alt='pic'>";
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main'))
      .toBe(`<img src='${BASE}/docs/pic.png' alt='pic'>`);
  });

  it('handles multiple img tags', () => {
    const html = '<img src="a.png" alt="a"> <img src="b.png" alt="b">';
    const result = rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main');
    expect(result).toContain(`${BASE}/a.png`);
    expect(result).toContain(`${BASE}/b.png`);
  });

  it('handles img tags with additional attributes', () => {
    const html = '<img width="100" src="./images/logo.png" height="50" alt="logo" class="center">';
    expect(rewriteRelativeHtmlImgSrcs(html, 'owner', 'repo', 'main'))
      .toContain(`${BASE}/images/logo.png`);
  });
});