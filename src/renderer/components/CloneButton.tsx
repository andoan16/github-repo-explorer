import { useState, useCallback } from 'react';

interface Props {
  repoUrl: string;
  repoName: string;
  label?: string;
}

type Status = 'idle' | 'cloning' | 'cloned' | 'error';

export default function CloneButton({ repoUrl, repoName, label }: Props) {
  const [status, setStatus] = useState<Status>('idle');

  const clone = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status === 'cloning') return;

    setStatus('cloning');
    const res = await window.repoExplorer.cloneRepo(repoUrl, repoName);

    if (!res.ok || !res.data) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
      return;
    }

    if (res.data.canceled) {
      setStatus('idle');
      return;
    }

    if (res.data.success) {
      setStatus('cloned');
      setTimeout(() => setStatus('idle'), 2500);
    } else {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [repoUrl, repoName, status]);

  const stateClass =
    status === 'cloning' ? 'clone-btn cloning' :
    status === 'cloned' ? 'clone-btn cloned' :
    status === 'error' ? 'clone-btn clone-error' :
    'clone-btn';

  const text =
    status === 'cloning' ? 'Cloning...' :
    status === 'cloned' ? 'Cloned!' :
    status === 'error' ? 'Failed' :
    (label ?? 'Clone');

  return (
    <button className={stateClass} onClick={clone} title="Clone repository to your machine" disabled={status === 'cloning'}>
      {status === 'cloning' ? (
        <span className="spinner" />
      ) : status === 'cloned' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : status === 'error' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )}
      <span>{text}</span>
    </button>
  );
}
