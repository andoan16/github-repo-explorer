import type { GitHubSearchResult } from '../../shared/types';

interface Props {
  results: GitHubSearchResult[];
  onClose: () => void;
}

export default function ComparisonView({ results, onClose }: Props) {
  const scoreColor = (s: number) => {
    if (s >= 80) return 'var(--success)';
    if (s >= 50) return 'var(--warning)';
    return 'var(--error)';
  };

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="comparison-panel" onClick={(e) => e.stopPropagation()}>
        <div className="comparison-header">
          <h2>Compare ({results.length} repos)</h2>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>

        <div className="comparison-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th></th>
                {results.map((r) => (
                  <th key={r.repo.id}>
                    <a href="#" onClick={(e) => { e.preventDefault(); window.open(r.repo.html_url, '_blank'); }}>
                      {r.repo.full_name}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="comp-label">Description</td>
                {results.map((r) => (
                  <td key={r.repo.id}>{r.repo.description || '—'}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Match</td>
                {results.map((r) => (
                  <td key={r.repo.id}>
                    <span style={{ color: scoreColor(Math.round(r.score.total * 100)), fontWeight: 600 }}>
                      {Math.round(r.score.total * 100)}%
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Stars</td>
                {results.map((r) => (
                  <td key={r.repo.id}>★ {r.repo.stars.toLocaleString()}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Forks</td>
                {results.map((r) => (
                  <td key={r.repo.id}>{r.repo.forks.toLocaleString()}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Open Issues</td>
                {results.map((r) => (
                  <td key={r.repo.id}>{r.repo.open_issues.toLocaleString()}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Language</td>
                {results.map((r) => (
                  <td key={r.repo.id}>{r.repo.language ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">License</td>
                {results.map((r) => (
                  <td key={r.repo.id}>{r.repo.license?.name ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Updated</td>
                {results.map((r) => (
                  <td key={r.repo.id}>{new Date(r.repo.updated_at).toLocaleDateString()}</td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Topics</td>
                {results.map((r) => (
                  <td key={r.repo.id}>
                    {r.repo.topics.slice(0, 6).map((t) => (
                      <span key={t} className="meta-tag topic" style={{ margin: '1px 2px 1px 0' }}>{t}</span>
                    ))}
                    {r.repo.topics.length === 0 && '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="comp-label">Why this matches</td>
                {results.map((r) => (
                  <td key={r.repo.id} className="comp-reason">{r.matchExplanation}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
