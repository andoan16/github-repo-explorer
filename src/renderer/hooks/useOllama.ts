import { useState, useCallback } from 'react';
import type { OllamaStatus, OllamaModel } from '../../shared/types';

export function useOllama() {
  const [status, setStatus] = useState<OllamaStatus>({ connected: false, models: [] });
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (baseUrl?: string) => {
    setChecking(true);
    const res = await window.repoExplorer.checkOllama(baseUrl);
    setChecking(false);
    if (res.ok && res.data) setStatus(res.data);
    else setStatus({ connected: false, error: res.error, models: [] });
    return res.ok;
  }, []);

  const refreshModels = useCallback(async () => {
    const res = await window.repoExplorer.listModels();
    if (res.ok && res.data) {
      setStatus((s) => ({ ...s, models: res.data as OllamaModel[], connected: true }));
    }
  }, []);

  return { status, checking, check, refreshModels };
}
