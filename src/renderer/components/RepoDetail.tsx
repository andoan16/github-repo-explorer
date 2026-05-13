import { useMemo } from 'react';
import { marked } from 'marked';
import type { GitHubSearchResult } from '../../shared/types';
import MatchExplanation from './MatchExplanation';
import CopyButton from './CopyButton';
import BookmarkButton from './BookmarkButton';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  result: GitHubSearchResult;
  bookmarked: boolean;
  onClose: () => void;
  onBookmark: (e: React.MouseEvent) => void;
  onFindSimilar: () => void;
}

export default function RepoDetail({ result, bookmarked, onClose, onBookmark, onFindSimilar }: Props) {
  const { repo, readme, score, matchExplanation } = result;

  const readmeHtml = useMemo(() => {
    if (!readme) return null;
    try {
      return marked.parse(readme) as string;
    } catch {
      return null;
    }
  }, [readme]);

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
            <BookmarkButton bookmarked={bookmarked} onClick={onBookmark} />
            <CopyButton url={repo.html_url} label="Clone" />
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

        <MatchExplanation explanation={matchExplanation} score={score} />

        {readmeHtml && (
          <details className="detail-readme" open>
            <summary>README</summary>
            <div className="readme-content" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
          </details>
        )}
      </div>
    </div>
  );
}
