import { useState, useCallback, useEffect } from 'react';
import type { OllamaStatus, OllamaModel, EmbeddedModelStatus, LlmProvider } from '../../shared/types';

export function useOllama() {
  const [provider, setProvider] = useState<LlmProvider>('embedded');
  const [embeddedStatus, setEmbeddedStatus] = useState<EmbeddedModelStatus>({
    status: 'loading',
    modelName: 'Qwen2.5-0.5B-Instruct (GGUF)',
    progress: 0,
  });
  const [status, setStatus] = useState<OllamaStatus>({ connected: false, models: [] });
  const [checking, setChecking] = useState(false);

  const fetchLlmStatus = useCallback(async () => {
    try {
      const res = await window.repoExplorer.getLlmStatus();
      if (res.ok && res.data) {
        setProvider(res.data.provider);
        setEmbeddedStatus(res.data.embedded);
        setStatus(res.data.ollama);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchLlmStatus();
    const unsub = window.repoExplorer.onLlmStatusUpdate?.((data: any) => {
      if (data?.provider) setProvider(data.provider);
      if (data?.embedded) setEmbeddedStatus(data.embedded);
      if (data?.ollama) setStatus(data.ollama);
    });
    return () => {
      unsub?.();
    };
  }, [fetchLlmStatus]);

  const downloadEmbeddedModel = useCallback(async (modelId?: string) => {
    await window.repoExplorer.downloadEmbeddedModel?.(modelId);
  }, []);

  const check = useCallback(async (baseUrl?: string, apiKey?: string) => {
    setChecking(true);
    const res = await window.repoExplorer.checkOllama(baseUrl, apiKey);
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

  return {
    provider,
    embeddedStatus,
    downloadEmbeddedModel,
    status,
    checking,
    check,
    refreshModels,
    fetchLlmStatus,
  };
}
