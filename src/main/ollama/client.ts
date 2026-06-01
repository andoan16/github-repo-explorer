import type { OllamaModel, OllamaStatus } from '../../shared/types';

export class OllamaClient {
  constructor(private baseUrl: string) {}

  async checkConnection(signal?: AbortSignal): Promise<OllamaStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: signal ?? AbortSignal.timeout(5000),
      });
      if (!res.ok) {
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
    });
    if (!res.ok) throw new Error(`Ollama /api/tags failed: HTTP ${res.status}`);
    const data = (await res.json()) as { models: OllamaModel[] };
    return data.models ?? [];
  }

  async generate(prompt: string, model: string, signal?: AbortSignal, maxTokens?: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: maxTokens ?? 512 },
      }),
      signal: signal ?? AbortSignal.timeout(120_000),
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