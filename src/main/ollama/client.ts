import type { OllamaModel, OllamaStatus } from '../../shared/types';

export class OllamaClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
  ) {
    // Normalize: strip a trailing /api so we don't double it up when we
    // append /api/... to the base URL. This handles users who paste the
    // documented cloud base URL (https://ollama.com/api) as well as the
    // plain hostname (https://ollama.com). Also strip trailing slash to
    // avoid double-slash in the final URL.
    this.baseUrl = baseUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  }

  /** Headers sent with every request. Adds Bearer auth when an API key is set
   *  (required for Ollama Cloud at https://ollama.com/api). */
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async checkConnection(signal?: AbortSignal): Promise<OllamaStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: signal ?? AbortSignal.timeout(10000),
        headers: this.headers(),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { connected: false, error: `Authentication failed (HTTP ${res.status}). Check your Ollama Cloud API key.`, models: [] };
        }
        return { connected: false, error: `Ollama returned HTTP ${res.status}`, models: [] };
      }
      const data = (await res.json()) as { models: OllamaModel[] };
      return { connected: true, models: data.models ?? [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if ((err as any)?.name === 'AbortError') {
        return { connected: false, error: 'Request cancelled', models: [] };
      }
      if (message.includes('ECONNREFUSED') || message.includes('Connection refused')) {
        return { connected: false, error: 'Ollama is not running. Start it with `ollama serve`.', models: [] };
      }
      return { connected: false, error: message, models: [] };
    }
  }

  async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, {
      signal,
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Ollama /api/tags failed: HTTP ${res.status}`);
    const data = (await res.json()) as { models: OllamaModel[] };
    return data.models ?? [];
  }

  async generate(prompt: string, model: string, signal?: AbortSignal, maxTokens?: number): Promise<string> {
    // Combine user-provided signal with a 120s timeout so that:
    // 1. Search cancellation still aborts the Ollama call immediately
    // 2. If the user signal lacks a timeout, we still prevent infinite hangs
    // Cloud requests may take longer, so use 180s timeout when an API key is set.
    const timeoutMs = this.apiKey ? 180_000 : 120_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: maxTokens ?? 512 },
      }),
      signal: combinedSignal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama generate failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { response: string };
    if (!data.response) throw new Error('Ollama returned empty response');
    return data.response;
  }
}