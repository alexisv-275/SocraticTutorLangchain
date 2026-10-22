import { ChatAnthropic } from '@langchain/anthropic';
import type { AppConfig } from './env.js';

export function createClaudeModel(config: AppConfig, fetchOverride?: typeof fetch) {
  // Desactivar los reintentos de ambas capas; el middleware gestiona el único permitido.
  return new ChatAnthropic({
    apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL,
    maxTokens: config.MAX_OUTPUT_TOKENS, maxRetries: 0, streaming: false,
    clientOptions: { maxRetries: 0, timeout: config.MODEL_TIMEOUT_MS, ...(fetchOverride ? { fetch: fetchOverride } : {}) },
  });
}
