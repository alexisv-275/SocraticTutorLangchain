import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeModel } from '../config/model.js';
import { readConfig, publicConfig } from '../config/env.js';
import { createStudyGraph } from '../graph/study-graph.js';
import { MetricsCollector } from '../infrastructure/metrics.js';
import { scenario } from '../fixtures/scenarios.js';
import { decision, mockGeneration } from '../fixtures/mock-model.js';
import type { GraphTurnState } from '../graph/state.js';
import { MemorySessionStore } from '../infrastructure/memory-store.js';
import { TurnCoordinator } from '../services/turn-coordinator.js';

test('ChatAnthropic serializa tres agentes y contabiliza todo el uso sin red', async () => {
  const config = readConfig({ ANTHROPIC_API_KEY: 'offline-test-key' });
  const script = [ { name: 'checkAnswer', input: {} },
    { name: 'handoffToAnalyst', input: { diagnosis: { result: 'CORRECT', evidence: 'PARTIAL', difficultyDetected: null, requiresVerification: true }, reason: 'Acierto objetivo sin transferencia previa.' } },
    { name: 'handoffToTutor', input: { strategyDecision: decision('VERIFY'), reason: 'Pedir aplicación en un nuevo contexto.' } },
    { name: 'submitIntervention', input: { intervention: mockGeneration('VERIFY') } } ];
  const requests: Record<string, unknown>[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    const item = script[requests.length - 1]!;
    return new Response(JSON.stringify({ id: `msg_${requests.length}`, type: 'message', role: 'assistant',
      model: config.ANTHROPIC_MODEL, content: [{ type: 'tool_use', id: `tool_${requests.length}`, ...item }],
      stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 30 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { session, action } = scenario('E1');
  const s: GraphTurnState = { action, sessionSnapshot: session, activeAgent: 'diagnostic_agent', agentActivationCount: 0,
    handoffCount: 0, lastHandoffReason: '', handoffMessages: [], finished: false };
  // mode=live prueba la contabilidad del adaptador, pero fetch jamás sale a Internet.
  const metrics = new MetricsCollector(config.ANTHROPIC_MODEL, 'live');
  const result = await createStudyGraph(createClaudeModel(config, fakeFetch), s, metrics).invoke({ turn: s });
  assert.equal(result.turn.finished, true);
  assert.equal(requests.length, 4);
  assert(requests.every(r => r.max_tokens === 2048 && r.temperature === undefined));
  const report = metrics.finish();
  assert.equal(report.llmCalls, 4); assert.equal(report.inputTokens, 400); assert.equal(report.outputTokens, 120);
  assert.equal(report.totalTokens, 520); assert.equal(report.usageIncomplete, false);
  assert.doesNotMatch(JSON.stringify(publicConfig(config)), /offline-test-key/);
});
test('configuración ausente o inválida falla sin mostrar secretos', () => {
  assert.throws(() => readConfig({}), /ANTHROPIC_API_KEY/);
  assert.throws(() => readConfig({ ANTHROPIC_API_KEY: 'secret', MAX_OUTPUT_TOKENS: 'invalid' }), /MAX_OUTPUT_TOKENS/);
});

test('HTTP 429: ChatAnthropic no reintenta ocultamente, solo hay dos solicitudes', async () => {
  let requests = 0;
  const config = readConfig({ ANTHROPIC_API_KEY: 'offline-key-never-exported' });
  const fakeFetch: typeof fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'sensitive-provider-message' } }),
      { status: 429, headers: { 'content-type': 'application/json' } });
  };
  const f = scenario('E1'); const store = new MemorySessionStore(); store.reset(f.session);
  const model = createClaudeModel(config, fakeFetch);
  const tutor = new TurnCoordinator(store, () => model, { model: config.ANTHROPIC_MODEL, mode: 'live' });
  const turn = await tutor.handleTurn(f.session.sessionId, f.action);
  assert.equal(requests, 2); assert.equal(turn.report.llmCalls, 2); assert.equal(turn.report.technicalRetries, 1);
  assert.equal(turn.report.status, 'error'); assert.equal(turn.report.usageIncomplete, true);
  assert(turn.report.llmAttempts.every(a => a.status === 'error' && a.inputTokens === null));
  assert.equal(store.get(f.session.sessionId)?.version, 1);
  assert.doesNotMatch(JSON.stringify(turn), /offline-key-never-exported|sensitive-provider-message/);
});
