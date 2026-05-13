import type { Bookmark } from '../../shared/types';
import CopyButton from './CopyButton';

interface Props {
  bookmarks: Bookmark[];
  onSelect: (bookmark: Bookmark) => void;
  onRemove: (repoId: number) => void;
  onClose: () => void;
}

export default function BookmarksPanel({ bookmarks, onSelect, onRemove, onClose }: Props) {
  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="bookmarks-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bookmarks-header">
          <h2>Bookmarks ({bookmarks.length})</h2>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>

        {bookmarks.length === 0 ? (
          <div className="bookmarks-empty">
            <p>No bookmarks yet. Click the bookmark icon on any repository result to save it here.</p>
          </div>
        ) : (
          <div className="bookmarks-list">
            {bookmarks.map((b) => (
              <div key={b.repo.id} className="bookmark-row">
                <div className="bookmark-info" onClick={() => onSelect(b)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(b)}>
                  <span className="bookmark-name">{b.repo.full_name}</span>
                  <span className="bookmark-desc">{b.repo.description ?? 'No description'}</span>
                  <span className="bookmark-meta">
                    ★ {b.repo.stars.toLocaleString()} · {b.repo.language ?? 'Unknown'} · Saved {new Date(b.savedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="bookmark-actions">
                  <CopyButton url={b.repo.html_url} />
                  <button className="bookmark-remove-btn" onClick={() => onRemove(b.repo.id)} title="Remove bookmark">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
