import os from 'os';
import type { EmbeddedModelId, SystemSpecs } from '../../shared/types';

/**
 * Inspects system hardware (RAM, CPU cores, architecture) and suggests
 * the most suitable embedded LLM model size.
 */
export function getSystemSpecs(overrideTotalMemBytes?: number): SystemSpecs {
  const totalMemoryBytes = overrideTotalMemBytes ?? os.totalmem();
  const totalMemoryGb = Math.round((totalMemoryBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const cpus = os.cpus() || [];
  const cpuCores = cpus.length;
  const cpuModel = cpus[0]?.model ? cpus[0].model.trim() : 'Unknown CPU';
  const platform = os.platform();
  const arch = os.arch();

  let suggestedModelId: EmbeddedModelId = 'qwen2.5-0.5b';
  let recommendationReason = '';

  // Heuristic based on RAM and CPU:
  // >= 15.0 GB RAM: Suggest 3B (ideal for Apple Silicon M-series or 16GB+ systems)
  // >= 7.5 GB RAM: Suggest 1.5B (standard 8GB-16GB machines)
  // < 7.5 GB RAM: Suggest 0.5B (lightweight, minimal memory footprint)
  if (totalMemoryGb >= 15.0) {
    suggestedModelId = 'qwen2.5-3b';
    recommendationReason = `Cấu hình phần cứng (${totalMemoryGb} GB RAM) phù hợp để chạy mô hình 3B.`;
  } else if (totalMemoryGb >= 7.5) {
    suggestedModelId = 'qwen2.5-1.5b';
    recommendationReason = `Cấu hình phần cứng (${totalMemoryGb} GB RAM) phù hợp để chạy mô hình 1.5B.`;
  } else {
    suggestedModelId = 'qwen2.5-0.5b';
    recommendationReason = `Cấu hình phần cứng (${totalMemoryGb} GB RAM) phù hợp để chạy mô hình 0.5B.`;
  }

  return {
    totalMemoryBytes,
    totalMemoryGb,
    cpuCores,
    cpuModel,
    platform,
    arch,
    suggestedModelId,
    recommendationReason,
  };
}
