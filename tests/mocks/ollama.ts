import { vi } from 'vitest';
import type { OllamaStatus, OllamaModel } from '../../src/shared/types';

export const mockModels: OllamaModel[] = [
  { name: 'llama3.2:latest', modified_at: '2025-01-01T00:00:00Z', size: 2_000_000_000 },
  { name: 'mistral:latest', modified_at: '2025-01-02T00:00:00Z', size: 4_000_000_000 },
  { name: 'codellama:7b', modified_at: '2025-01-03T00:00:00Z', size: 3_800_000_000 },
];

export function createMockOllamaClient() {
  return {
    checkConnection: vi.fn().mockResolvedValue({
      connected: true,
      models: mockModels,
    } as OllamaStatus),
    listModels: vi.fn().mockResolvedValue(mockModels),
    generate: vi.fn().mockResolvedValue('{"searchQuery":"CI/CD Docker self-hosted","technologies":["Docker","Go","Python"],"intent":"devops-tool","minStars":50,"preferredLicense":"mit","requireRecentActivity":true}'),
  };
}

export function createDisconnectedOllamaClient() {
  return {
    checkConnection: vi.fn().mockResolvedValue({
      connected: false,
      error: 'Ollama is not running. Start it with `ollama serve`.',
      models: [],
    } as OllamaStatus),
    listModels: vi.fn().mockRejectedValue(new Error('Connection refused')),
    generate: vi.fn().mockRejectedValue(new Error('Ollama unavailable')),
  };
}
