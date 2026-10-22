import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { createStudyGraph } from '../graph/study-graph.js';
import type { GraphTurnState } from '../graph/state.js';
import { MetricsCollector } from '../infrastructure/metrics.js';
import { MemorySessionStore } from '../infrastructure/memory-store.js';
import { scenario } from '../fixtures/scenarios.js';
import { ScriptedModel, decision, mockGeneration, type MockStep } from '../fixtures/mock-model.js';
import { checkAnswer, validateDiagnosis, validateStrategy } from '../domain/policy.js';

const diagnosis = { result: 'CORRECT', evidence: 'PARTIAL', difficultyDetected: null, requiresVerification: true };
function initial(): GraphTurnState {
  const { session, action } = scenario('E1');
  return { action, sessionSnapshot: session, activeAgent: 'diagnostic_agent', handoffCount: 0, agentActivationCount: 0,
    lastHandoffReason: '', finished: false, handoffMessages: [] };
}
const diagnostic: MockStep[] = [ { name: 'checkAnswer', args: {} },
  { name: 'handoffToAnalyst', args: { diagnosis, reason: 'Acierto objetivo; aún falta transferencia.' } } ];
const finish: MockStep[] = [ { name: 'handoffToTutor', args: { strategyDecision: decision('VERIFY'), reason: 'Comprobar aplicación en un nuevo contexto.' } },
  { name: 'submitIntervention', args: { intervention: mockGeneration('VERIFY') } } ];

test('tres createAgent ejecutan herramientas reales y Command.PARENT termina el turno', async () => {
  const s = initial(); const metrics = new MetricsCollector('mock', 'mock');
  const result = await createStudyGraph(new ScriptedModel([...diagnostic, ...finish]), s, metrics).invoke({ turn: s });
  assert.equal(result.turn.finished, true);
  assert.equal(result.turn.agentActivationCount, 3);
  assert.equal(metrics.attempts.length, 4);
  assert.deepEqual(metrics.agentTrace.map(t => t.role), ['diagnostic_agent', 'analyst_agent', 'tutor_agent']);
  const [ai, tool] = result.turn.handoffMessages;
  assert(AIMessage.isInstance(ai)); assert(ToolMessage.isInstance(tool));
  assert.equal(ai.tool_calls![0]!.id, tool.tool_call_id);
});
test('ruta alternativa Analista → Diagnosticador → Analista → Tutor usa cuatro activaciones', async () => {
  const s = { ...initial(), activeAgent: 'analyst_agent' as const };
  const metrics = new MetricsCollector('mock', 'mock');
  const model = new ScriptedModel([{ name: 'requestRediagnosis', args: { reason: 'Falta el diagnóstico objetivo de esta respuesta.' } }, ...diagnostic, ...finish]);
  const result = await createStudyGraph(model, s, metrics).invoke({ turn: s });
  assert.equal(result.turn.finished, true);
  assert.equal(result.turn.handoffCount, 3);
  assert.equal(result.turn.agentActivationCount, 4);
  assert.equal(metrics.attempts.length, 5);
});
test('ciclo excede presupuesto y el store permanece intacto', async () => {
  const s = initial(); const store = new MemorySessionStore(); store.reset(s.sessionSnapshot);
  const before = store.get(s.sessionSnapshot.sessionId);
  const metrics = new MetricsCollector('mock', 'mock');
  const model = new ScriptedModel([...diagnostic,
    { name: 'requestRediagnosis', args: { reason: 'Aclara la evidencia disponible de transferencia.' } },
    { name: 'checkAnswer', args: {} },
    { name: 'handoffToAnalyst', args: { diagnosis, reason: 'Revisado el historial: no consta transferencia previa.' } },
    { name: 'handoffToTutor', args: { strategyDecision: decision('VERIFY'), reason: 'Enviar estrategia de transferencia al Tutor.' } }]);
  await assert.rejects(createStudyGraph(model, s, metrics).invoke({ turn: s }), /presupuesto/);
  assert.equal(metrics.attempts.length, 6);
  assert.equal(metrics.handoffs.at(-1)?.accepted, false);
  assert.deepEqual(store.get(s.sessionSnapshot.sessionId), before);
});
test('la clave y la simplificación no pueden ser contradichas por el LLM', () => {
  const e3 = scenario('E3');
  assert.equal(checkAnswer(e3.session, e3.action), 'INCORRECT');
  assert.throws(() => validateDiagnosis(e3.session, e3.action, diagnosis), /clave/);
  assert.throws(() => validateStrategy(e3.session, e3.action, decision('HINT')), /reglas/);
});
test('copias del store y compare-and-swap protegen el estado canónico', () => {
  const store = new MemorySessionStore(); const s = initial().sessionSnapshot;
  store.save(s, 0); s.history.length = 0; s.consecutiveErrors = 100;
  const copy = store.get(s.sessionId)!; copy.session.consecutiveErrors = 200;
  assert.equal(store.get(s.sessionId)!.session.consecutiveErrors, 0);
  assert.throws(() => store.save(s, 0), /sesión cambió/);
});
