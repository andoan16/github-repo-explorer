import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { app } from 'electron';
import type { GitHubRepo } from '../../shared/types';
import type { ILlmClient } from '../llm/types';

export const MINI_LM_MODEL_FILENAME = 'all-MiniLM-L6-v2-Q4_K_M.gguf';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const vA = a[i];
    const vB = b[i];
    dot += vA * vB;
    normA += vA * vA;
    normB += vB * vB;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, sim));
}

/**
 * In-process N-gram / TF-IDF vectorizer fallback when local neural embeddings
 * are loading, unavailable, or running in an environment without GGUF models.
 */
export function computeTfIdfVector(text: string, vocab: Map<string, number>): number[] {
  const vec = new Array(vocab.size).fill(0);
  const words = text.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  for (const w of words) {
    const idx = vocab.get(w);
    if (idx !== undefined) {
      vec[idx] += 1;
    }
  }
  // Also add bigrams for phrase matching
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    const idx = vocab.get(bigram);
    if (idx !== undefined) {
      vec[idx] += 1.5;
    }
  }
  return vec;
}

export class VectorReranker {
  private embeddingModelPath: string | null = null;
  private llamaModel: any = null;
  private embedContext: any = null;
  private isInitializing = false;
  private vectorCache = new Map<string, number[]>();

  constructor(customPath?: string) {
    if (customPath) {
      this.embeddingModelPath = customPath;
    } else {
      this.embeddingModelPath = this.resolveModelPath();
    }
  }

  private resolveModelPath(): string | null {
    try {
      // 1. Check userData/models
      let userDir = '/tmp';
      try {
        userDir = app.getPath('userData');
      } catch {
        userDir = join(homedir(), '.repo-explorer');
      }
      const appPath = join(userDir, 'models', MINI_LM_MODEL_FILENAME);
      if (existsSync(appPath)) return appPath;

      // 2. Check ~/.node-llama-cpp/models
      const cliPath = join(homedir(), '.node-llama-cpp', 'models', MINI_LM_MODEL_FILENAME);
      if (existsSync(cliPath)) return cliPath;
    } catch {
      return null;
    }
    return null;
  }

  public async getLocalEmbedding(text: string): Promise<number[] | null> {
    const cached = this.vectorCache.get(text);
    if (cached) return cached;

    if (!this.embeddingModelPath && !this.resolveModelPath()) {
      return null;
    }

    if (!this.embedContext && !this.isInitializing) {
      this.isInitializing = true;
      try {
        const modelFile = this.embeddingModelPath || this.resolveModelPath();
        if (modelFile && existsSync(modelFile)) {
          const { getLlama } = await import('node-llama-cpp');
          const llama = await getLlama();
          this.llamaModel = await llama.loadModel({ modelPath: modelFile });
          this.embedContext = await this.llamaModel.createEmbeddingContext();
        }
      } catch (err) {
        console.warn('[vector-reranker] Failed to initialize neural embedding model:', err);
      } finally {
        this.isInitializing = false;
      }
    }

    if (this.embedContext) {
      try {
        let safeText = text;
        const maxTokens = (this.embedContext._llamaContext?.contextSize ?? 512) - 16;
        if (typeof this.embedContext.calculateInputLength === 'function') {
          if (this.embedContext.calculateInputLength(safeText) >= maxTokens) {
            if (this.llamaModel?.tokenize && this.llamaModel?.detokenize) {
              const tokens = this.llamaModel.tokenize(safeText);
              safeText = this.llamaModel.detokenize(tokens.slice(0, maxTokens - 10));
            } else {
              safeText = safeText.slice(0, 1000);
            }
          }
        } else if (safeText.length > 1200) {
          safeText = safeText.slice(0, 1200);
        }

        const res = await this.embedContext.getEmbeddingFor(safeText);
        if (res?.vector && Array.isArray(res.vector)) {
          this.vectorCache.set(text, res.vector);
          return res.vector;
        }
      } catch (err) {
        console.warn('[vector-reranker] Neural embedding failed, falling back:', err);
      }
    }

    return null;
  }

  /**
   * Computes semantic vector similarity between user query and candidate repositories.
   * Returns a Map of repo.id -> similarity score in [0.0, 1.0].
   */
  public async rerankCandidates(
    queryText: string,
    candidates: GitHubRepo[],
    readmes: Map<number, string | null>,
    llmClient?: ILlmClient,
    signal?: AbortSignal,
  ): Promise<Map<number, number>> {
    const scores = new Map<number, number>();
    if (candidates.length === 0 || !queryText.trim()) return scores;

    // 1. Try neural embeddings first (either dedicated all-MiniLM or via LLM client)
    let queryVec = await this.getLocalEmbedding(queryText);
    if (!queryVec && llmClient?.getEmbedding) {
      try {
        queryVec = await llmClient.getEmbedding(queryText, undefined, signal);
      } catch {
        queryVec = null;
      }
    }

    if (queryVec) {
      const rawScores: { id: number; sim: number }[] = [];
      for (const repo of candidates) {
        if (signal?.aborted) break;
        const readmeSnippet = (readmes.get(repo.id) ?? '').slice(0, 400);
        const docText = `${repo.full_name}: ${repo.description ?? ''}. Topics: ${repo.topics.join(' ')}. ${readmeSnippet}`;
        let docVec = await this.getLocalEmbedding(docText);
        if (!docVec && llmClient?.getEmbedding) {
          try {
            docVec = await llmClient.getEmbedding(docText, undefined, signal);
          } catch {
            docVec = null;
          }
        }

        if (docVec) {
          const sim = cosineSimilarity(queryVec, docVec);
          rawScores.push({ id: repo.id, sim });
        }
      }

      if (rawScores.length > 0) {
        // Apply Min-Max calibration to preserve contrast
        const sims = rawScores.map(r => r.sim);
        const minSim = Math.min(...sims);
        const maxSim = Math.max(...sims);
        const range = maxSim - minSim;

        for (const item of rawScores) {
          if (range > 0.05) {
            // Calibrate to [0.2, 1.0] range
            const normalized = 0.2 + 0.8 * ((item.sim - minSim) / range);
            scores.set(item.id, Math.round(normalized * 100) / 100);
          } else {
            scores.set(item.id, Math.round(item.sim * 100) / 100);
          }
        }
        return scores;
      }
    }

    // 2. Fallback: In-process TF-IDF N-gram cosine similarity (zero-dependency)
    const vocab = new Map<string, number>();
    const allTexts = [
      queryText,
      ...candidates.map(c => `${c.full_name} ${c.description ?? ''} ${c.topics.join(' ')} ${(readmes.get(c.id) ?? '').slice(0, 400)}`),
    ];

    let termIndex = 0;
    for (const t of allTexts) {
      const words = t.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
      for (const w of words) {
        if (!vocab.has(w)) vocab.set(w, termIndex++);
      }
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = `${words[i]}_${words[i + 1]}`;
        if (!vocab.has(bigram)) vocab.set(bigram, termIndex++);
      }
    }

    const qTfIdf = computeTfIdfVector(queryText, vocab);
    const rawTfIdf: { id: number; sim: number }[] = [];
    for (const repo of candidates) {
      const readmeSnippet = (readmes.get(repo.id) ?? '').slice(0, 400);
      const docText = `${repo.full_name} ${repo.description ?? ''} ${repo.topics.join(' ')} ${readmeSnippet}`;
      const docVec = computeTfIdfVector(docText, vocab);
      const sim = cosineSimilarity(qTfIdf, docVec);
      rawTfIdf.push({ id: repo.id, sim });
    }

    const sims = rawTfIdf.map(r => r.sim);
    const minSim = Math.min(...sims);
    const maxSim = Math.max(...sims);
    const range = maxSim - minSim;

    for (const item of rawTfIdf) {
      if (range > 0.02) {
        const normalized = 0.2 + 0.8 * ((item.sim - minSim) / range);
        scores.set(item.id, Math.round(normalized * 100) / 100);
      } else {
        scores.set(item.id, Math.round(item.sim * 100) / 100);
      }
    }

    return scores;
  }

  public async dispose(): Promise<void> {
    try {
      if (this.embedContext) {
        await this.embedContext.dispose?.();
        this.embedContext = null;
      }
      if (this.llamaModel) {
        await this.llamaModel.dispose?.();
        this.llamaModel = null;
      }
    } catch {
      // ignore
    }
  }
}

export const vectorReranker = new VectorReranker();
