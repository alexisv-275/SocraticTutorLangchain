import { config } from 'dotenv';
import { z } from 'zod';
import { TurnError } from '../domain/errors.js';

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1),
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-sonnet-4-6'),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8192).default(2048),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(45000),
  TURN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(180000),
});
export type AppConfig = z.infer<typeof EnvSchema>;
export function readConfig(env?: NodeJS.ProcessEnv): AppConfig {
  if (!env) config({ quiet: true });
  const parsed = EnvSchema.safeParse(env ?? process.env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(i => i.path[0]))].join(', ');
    throw new TurnError('CONFIGURATION', `Configura ${fields} en .env. Usa .env.example como referencia; nunca compartas la clave.`);
  }
  return parsed.data;
}
export function publicConfig(config: AppConfig) {
  return { model: config.ANTHROPIC_MODEL, maxOutputTokens: config.MAX_OUTPUT_TOKENS,
    sampling: 'provider-default', maxRetries: 0, modelTimeoutMs: config.MODEL_TIMEOUT_MS, turnTimeoutMs: config.TURN_TIMEOUT_MS };
}
