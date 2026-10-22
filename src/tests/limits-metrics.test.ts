import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage } from '@langchain/core/messages';
import { MetricsCollector } from '../infrastructure/metrics.js';
import { blankRubric } from '../infrastructure/reports.js';
import { MemorySessionStore } from '../infrastructure/memory-store.js';
import { TurnCoordinator } from '../services/turn-coordinator.js';
import { ScriptedModel, decision, mockGeneration, toolMessage, type MockStep } from '../fixtures/mock-model.js';
import { scenario } from '../fixtures/scenarios.js';

test('presupuesto de seis llamadas detiene una herramienta repetida sin confirmar', async () => {
  const f = scenario('E1'); const store = new MemorySessionStore(); store.reset(f.session);
  const model = new ScriptedModel(Array.from({ length: 7 }, () => ({ name: 'checkAnswer', args: {} })));
  const tutor = new TurnCoordinator(store, () => model, { model: 'mock', mode: 'mock' });
  const before = store.get(f.session.sessionId);
  const turn = await tutor.handleTurn(f.session.sessionId, f.action);
  assert.equal(turn.report.error?.code, 'MODEL_BUDGET');
  assert.equal(model.index, 6); assert.equal(turn.report.simulatedModelCalls, 6);
  assert.deepEqual(store.get(f.session.sessionId), before);
});
test('el único reintento es global y los errores sin uso conservan tokens null', async () => {
  const f = scenario('E1'); const store = new MemorySessionStore(); store.reset(f.session);
  const unavailable = () => Object.assign(new Error('unavailable'), { status: 503 });
  const model = new ScriptedModel([unavailable(), { name: 'checkAnswer', args: {} },
    { name: 'handoffToAnalyst', args: { diagnosis: { result: 'CORRECT', evidence: 'PARTIAL', difficultyDetected: null, requiresVerification: true }, reason: 'Acierto sin evidencia previa de transferencia.' } }, unavailable()]);
  const tutor = new TurnCoordinator(store, () => model, { model: 'transport-test', mode: 'live' });
  const turn = await tutor.handleTurn(f.session.sessionId, f.action);
  assert.equal(turn.report.status, 'error'); assert.equal(turn.report.technicalRetries, 1);
  assert.equal(turn.report.llmCalls, 4); assert.equal(turn.report.llmAttempts.filter(a => a.status === 'error').length, 2);
  assert(turn.report.llmAttempts.every(a => a.inputTokens === null && a.outputTokens === null));
  assert.equal(turn.report.usageIncomplete, true); assert.equal(store.get(f.session.sessionId)?.version, 1);
});
test('contabilidad idempotente: callbacks duplicados no duplican tokens', async () => {
  const metrics = new MetricsCollector('test', 'live'); const callback = metrics.callbacks('tutor_agent');
  callback.handleChatModelStart({}, [], 'call'); callback.handleChatModelStart({}, [], 'call');
  const output = { generations: [[{ text: '', message: new AIMessage({ content: '', usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }) }]] };
  callback.handleLLMEnd(output, 'call'); callback.handleLLMEnd(output, 'call');
  const report = metrics.finish(); assert.equal(report.llmCalls, 1); assert.equal(report.totalTokens, 15);
});
test('aclaración Tutor → Analista funciona dentro del presupuesto en REQUEST_HINT', async () => {
  const f = scenario('E2'); const store = new MemorySessionStore(); store.reset(f.session);
  const delegation: MockStep = { name: 'handoffToTutor', args: { strategyDecision: decision('HINT'), reason: 'Ofrecer una pista para el siguiente intento.' } };
  const model = new ScriptedModel([delegation,
    { name: 'requestStrategyClarification', args: { reason: 'Aclara qué responsabilidad destacar sin nombrar la opción.' } },
    { name: 'handoffToTutor', args: { strategyDecision: { ...decision('HINT'), justification: 'Contrasta responsabilidad sobre valor con facilitación.' }, reason: 'La pista debe contrastar valor con facilitación.' } },
    { name: 'submitIntervention', args: { intervention: mockGeneration('HINT') } }]);
  const tutor = new TurnCoordinator(store, () => model, { model: 'mock', mode: 'mock' });
  const turn = await tutor.handleTurn(f.session.sessionId, { action: 'REQUEST_HINT', questionId: 'Q01' });
  assert.equal(turn.report.status, 'ok'); assert.equal(turn.report.handoffs.length, 3);
  assert.deepEqual(turn.report.agentTrace.map(t => t.role), ['analyst_agent', 'tutor_agent', 'analyst_agent', 'tutor_agent']);
});
test('timeout aborta sin confirmar incluso si el modelo entrega tarde', async () => {
  const f = scenario('E1'); const store = new MemorySessionStore(); store.reset(f.session);
  class SlowModel extends ScriptedModel {
    override async _generate() {
      await new Promise(resolve => setTimeout(resolve, 60));
      return { generations: [{ text: '', message: toolMessage('checkAnswer', {}) }] };
    }
  }
  const tutor = new TurnCoordinator(store, () => new SlowModel([]), { model: 'mock', mode: 'mock', timeoutMs: 10 });
  const turn = await tutor.handleTurn(f.session.sessionId, f.action);
  assert.equal(turn.report.status, 'error'); assert.equal(store.get(f.session.sessionId)?.version, 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(store.get(f.session.sessionId)?.version, 1);
});
test('rúbrica manual permanece vacía: cero no equivale a sin evaluar', () => {
  const rubric = blankRubric();
  assert.equal(rubric.passedChecks, null); assert.equal(rubric.criticalFailures, null);
  assert.equal(rubric.compliancePercent, null); assert.equal(rubric.cases.length, 5);
  assert(rubric.cases.every(c => c.checks.length === 3 && c.checks.every(v => v.passed === null)));
});
