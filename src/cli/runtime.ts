import { createClaudeModel } from '../config/model.js';
import { publicConfig, readConfig } from '../config/env.js';
import { MemorySessionStore } from '../infrastructure/memory-store.js';
import { TurnCoordinator } from '../services/turn-coordinator.js';
import { scenarioModel } from '../fixtures/mock-model.js';

export function createRuntime(mock: boolean) {
  const store = new MemorySessionStore();
  if (mock) return new TurnCoordinator(store, scenarioModel, { model: 'scripted-offline', mode: 'mock' });
  const config = readConfig();
  const model = createClaudeModel(config);
  return new TurnCoordinator(store, () => model, { model: config.ANTHROPIC_MODEL, mode: 'live',
    timeoutMs: config.TURN_TIMEOUT_MS, effectiveConfig: publicConfig(config) });
}
