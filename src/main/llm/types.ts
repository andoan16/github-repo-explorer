export interface ILlmClient {
  generate(prompt: string, model?: string, signal?: AbortSignal, maxTokens?: number): Promise<string>;
  getEmbedding?(text: string, model?: string, signal?: AbortSignal): Promise<number[]>;
}
