import React from 'react';
import type { GitHubSearchResult } from '../../shared/types';
import CloneButton from './CloneButton';
import BookmarkButton from './BookmarkButton';

interface Props {
  result: GitHubSearchResult;
  rank: number;
  bookmarked: boolean;
  onClick: () => void;
  onBookmark: (e: React.MouseEvent) => void;
  onFindSimilar: () => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default React.memo(function ResultCard({ result, rank, bookmarked, onClick, onBookmark, onFindSimilar }: Props) {
  const { repo, score } = result;
  const scorePercent = Math.round(score.total * 100);

  return (
    <div className="result-card">
      <div className="result-rank">
        <span>#{rank}</span>
      </div>
      <div className="result-body" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
        <div className="result-header">
          <h3 className="result-name">{repo.full_name}</h3>
          <span className={`result-score score-${scorePercent >= 80 ? 'high' : scorePercent >= 50 ? 'mid' : 'low'}`}>
            {scorePercent}% match
          </span>
        </div>
        <p className="result-description">{repo.description || 'No description available.'}</p>
        <div className="result-meta">
          {repo.language && <span className="meta-tag language">{repo.language}</span>}
          <span className="meta-tag stars">★ {repo.stars.toLocaleString()}</span>
          <span className="meta-tag forks">⑂ {repo.forks.toLocaleString()}</span>
          {repo.license && <span className="meta-tag license">{repo.license.name}</span>}
          <span className="meta-tag updated">Updated {timeAgo(repo.updated_at)}</span>
          {repo.topics.slice(0, 3).map((t) => (
            <span key={t} className="meta-tag topic">{t}</span>
          ))}
        </div>
      </div>
      <div className="result-actions">
        <CloneButton repoUrl={repo.html_url} repoName={repo.full_name.split('/')[1]} />
        <BookmarkButton bookmarked={bookmarked} onClick={onBookmark} />
        <button className="find-similar-btn" onClick={(e) => { e.stopPropagation(); onFindSimilar(); }} title="Find similar repositories">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
            <path d="M8 11h6M11 8v6" />
          </svg>
          Similar
        </button>
      </div>
    </div>
  );
});