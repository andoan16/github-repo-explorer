import { useMemo, useState, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { GitHubSearchResult } from '../../shared/types';
import MatchExplanation from './MatchExplanation';
import CloneButton from './CloneButton';
import BookmarkButton from './BookmarkButton';

marked.setOptions({ breaks: true, gfm: true });

// Sanitize HTML before rendering to prevent XSS from untrusted GitHub README content.
// Allow common README elements (headings, lists, code, images, links, tables) but strip
// scripts, event handlers, iframes, and other dangerous markup.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1','h2','h3','h4','h5','h6','p','br','hr','blockquote','pre','code',
    'em','strong','del','sup','sub','mark','small','abbr','cite','q',
    'ul','ol','li','dl','dt','dd',
    'table','thead','tbody','tr','th','td','caption','colgroup','col',
    'a','img','span','div','figure','figcaption','details','summary',
    'kbd','samp','var','time','address','article','aside','header','footer','section',
  ],
  ALLOWED_ATTR: ['href','src','alt','title','width','height','colspan','rowspan','target','rel','align','valign','id','class','datetime'],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script','style','iframe','object','embed','form','input','textarea','button','select','option','link','meta','base'],
  FORBID_ATTR: ['onerror','onload','onclick','onmouseover','onmouseout','onfocus','onblur','onchange','oninput','onsubmit','formaction','action','method'],
};

/**
 * Rewrite relative image URLs in Markdown to absolute GitHub raw URLs.
 * READMEs often contain relative paths like `./images/logo.png` or `docs/img/badge.svg`
 * which resolve against the Electron renderer's local origin instead of the repo.
 * Without rewriting, these images 404.
 */
function rewriteRelativeImageUrls(markdown: string, owner: string, repo: string, branch: string): string {
  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
  // Match markdown images: ![alt](url)  — capture the URL portion
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      // Don't rewrite absolute URLs (http/https) or data URIs or anchor-only links
      if (/^(https?:\/\/|data:|#)/i.test(url)) return match;
      // Strip leading ./ from relative paths
      const cleanUrl = url.replace(/^\.\//, '');
      return `![${alt}](${baseUrl}/${cleanUrl})`;
    },
  );
}

/**
 * Rewrite relative src attributes in HTML <img> tags to absolute GitHub raw URLs.
 * Handles bare HTML images embedded in Markdown (e.g., <img src="./logo.png">).
 */
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

interface Props {
  result: GitHubSearchResult;
  bookmarked: boolean;
  onClose: () => void;
  onBookmark: (e: React.MouseEvent) => void;
}

export default function RepoDetail({ result, bookmarked, onClose, onBookmark }: Props) {
  const { repo, readme, score, matchExplanation, requestContext } = result;

  const [explanation, setExplanation] = useState(matchExplanation);
  const [explanationLoading, setExplanationLoading] = useState(false);

  useEffect(() => {
    if (requestContext && matchExplanation.startsWith('Score:')) {
      setExplanationLoading(true);
      window.repoExplorer.generateExplanation(repo.full_name, repo.description, requestContext)
        .then((res) => {
          if (res.ok && res.data) {
            setExplanation((res.data as { explanation: string }).explanation);
          }
        })
        .catch(() => {})
        .finally(() => setExplanationLoading(false));
    }
  }, [repo.full_name, repo.description, matchExplanation, requestContext]);

  // Lazy README fetch (not pre-fetched during search for speed)
  const [lazyReadme, setLazyReadme] = useState<string | null>(readme);
  const [readmeLoading, setReadmeLoading] = useState(readme === null);

  useEffect(() => {
    if (readme) {
      setLazyReadme(readme);
      setReadmeLoading(false);
      return;
    }
    setReadmeLoading(true);
    const [owner, name] = repo.full_name.split('/');
    window.repoExplorer.getReadme(owner, name, repo.default_branch, repo.id)
      .then((res) => {
        if (res.ok && res.data) {
          setLazyReadme((res.data as { readme: string | null }).readme);
        }
      })
      .catch(() => {})
      .finally(() => setReadmeLoading(false));
  }, [repo.id, repo.full_name, repo.default_branch, readme]);

  const readmeHtml = useMemo(() => {
    if (!lazyReadme) return null;
    try {
      const [owner, name] = repo.full_name.split('/');
      const rewritten = rewriteRelativeImageUrls(lazyReadme, owner, name, repo.default_branch);
      const parsed = marked.parse(rewritten) as string;
      const html = rewriteRelativeHtmlImgSrcs(parsed, owner, name, repo.default_branch);
      // Sanitize untrusted GitHub README HTML to prevent XSS in the renderer process.
      return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
    } catch {
      return null;
    }
  }, [lazyReadme, repo.full_name, repo.default_branch]);

  const openInBrowser = () => {
    window.open(repo.html_url, '_blank');
  };

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <div>
            <h2>{repo.full_name}</h2>
            <a className="detail-url" href="#" onClick={(e) => { e.preventDefault(); openInBrowser(); }}>
              {repo.html_url}
            </a>
          </div>
          <div className="detail-actions">
            <CloneButton repoUrl={repo.html_url} repoName={repo.full_name.split('/')[1]} />
            <BookmarkButton bookmarked={bookmarked} onClick={onBookmark} />
            <button className="btn-primary" onClick={openInBrowser}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open on GitHub
            </button>
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="detail-stats">
          <div className="stat">
            <span className="stat-value">{repo.stars.toLocaleString()}</span>
            <span className="stat-label">Stars</span>
          </div>
          <div className="stat">
            <span className="stat-value">{repo.forks.toLocaleString()}</span>
            <span className="stat-label">Forks</span>
          </div>
          <div className="stat">
            <span className="stat-value">{repo.open_issues.toLocaleString()}</span>
            <span className="stat-label">Open Issues</span>
          </div>
          <div className="stat">
            <span className="stat-value">{repo.language ?? '—'}</span>
            <span className="stat-label">Language</span>
          </div>
          <div className="stat">
            <span className="stat-value">{repo.license?.name ?? '—'}</span>
            <span className="stat-label">License</span>
          </div>
          <div className="stat">
            <span className="stat-value">{new Date(repo.updated_at).toLocaleDateString()}</span>
            <span className="stat-label">Updated</span>
          </div>
        </div>

        <p className="detail-description">{repo.description || 'No description available.'}</p>

        {repo.topics.length > 0 && (
          <div className="detail-topics">
            {repo.topics.map((t) => (
              <span key={t} className="meta-tag topic">{t}</span>
            ))}
          </div>
        )}

        <MatchExplanation explanation={explanation} score={score} loading={explanationLoading} />

        {readmeLoading && (
          <div className="detail-readme">
            <summary>README</summary>
            <div className="readme-loading">
              <span className="spinner small" />
              <p>Loading README...</p>
            </div>
          </div>
        )}

        {!readmeLoading && readmeHtml && (
          <details className="detail-readme" open>
            <summary>README</summary>
            <div className="readme-content" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
          </details>
        )}

        {!readmeLoading && !readmeHtml && (
          <div className="detail-readme">
            <summary>README</summary>
            <p className="readme-empty">No README available for this repository.</p>
          </div>
        )}
      </div>
    </div>
  );
}
