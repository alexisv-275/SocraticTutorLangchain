import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage } from '@langchain/core/messages';
import { MemorySessionStore } from '../infrastructure/memory-store.js';
import { TurnCoordinator, type ModelFactory } from '../services/turn-coordinator.js';
import { scenario, scenarioIds } from '../fixtures/scenarios.js';
import { ScriptedModel, scenarioModel, mockGeneration, decision } from '../fixtures/mock-model.js';
import { emptySession } from '../fixtures/scenarios.js';
import { agentContext } from '../graph/study-graph.js';

test('selección inicial y E5 exponen CHANGE_TOPIC al Analista y llegan al Tutor', async () => {
  for (const session of [emptySession('first-topic'), scenario('E5').session]) {
    const store = new MemorySessionStore(); store.reset(session);
    const action = { action: 'CHANGE_TOPIC' as const, targetTopicId: 'scrum-events' };
    const context = agentContext({ action, sessionSnapshot: session, activeAgent: 'analyst_agent',
      agentActivationCount: 0, handoffCount: 0, lastHandoffReason: '', finished: false, handoffMessages: [] }, 'analyst_agent');
    assert.equal('requiredStrategy' in context && context.requiredStrategy, 'CHANGE_TOPIC');
    const tutor = new TurnCoordinator(store, scenarioModel, { model: 'mock', mode: 'mock' });
    const turn = await tutor.handleTurn(session.sessionId, action);
    assert.equal(turn.report.status, 'ok');
    assert.equal(turn.response.question?.questionType, 'INITIAL');
    assert.deepEqual(turn.report.agentTrace.map(t => t.role), ['analyst_agent', 'tutor_agent']);
    assert.deepEqual(store.get(session.sessionId)!.session.history.slice(0, session.history.length), session.history);
  }
});

test('START_TOPIC rechazado al elegir tema deja evidencia y conserva la sesión', async () => {
  const session = emptySession('wrong-strategy'); const store = new MemorySessionStore(); store.reset(session);
  const before = store.get(session.sessionId);
  const tutor = new TurnCoordinator(store, () => new ScriptedModel([{ name: 'handoffToTutor', args: {
    strategyDecision: decision('START_TOPIC'), reason: 'Comenzar el tema seleccionado por el estudiante.' } }]), { model: 'mock', mode: 'mock' });
  const turn = await tutor.handleTurn(session.sessionId, { action: 'CHANGE_TOPIC', targetTopicId: 'scrum-roles' });
  assert.equal(turn.report.error?.code, 'INVALID_STRATEGY');
  assert.equal(turn.report.handoffs[0]?.strategyValidation?.expected, 'CHANGE_TOPIC');
  assert.equal(turn.report.handoffs[0]?.strategyValidation?.received, 'START_TOPIC');
  assert.equal(turn.report.simulatedModelCalls, 1);
  assert.deepEqual(store.get(session.sessionId), before);
});

function setup(id: typeof scenarioIds[number] = 'E1', factory: ModelFactory = scenarioModel) {
  const store = new MemorySessionStore(); const f = scenario(id); store.reset(f.session);
  return { ...f, store, tutor: new TurnCoordinator(store, factory, { model: 'mock', mode: 'mock' }) };
}

test('pista extensa se confirma y registra concisión sin contar errores por pedir ayuda', async () => {
  const { tutor, store, session } = setup('E2', () => new ScriptedModel([
    { name: 'handoffToTutor', args: { strategyDecision: decision('HINT'), reason: 'Ofrecer una pista sin revelar la respuesta.' } },
    { name: 'submitIntervention', args: { intervention: { ...mockGeneration('HINT'), message: 'idea '.repeat(101).trim() } } },
  ]));
  const before = store.get(session.sessionId);
  const turn = await tutor.handleTurn(session.sessionId, { action: 'REQUEST_HINT', questionId: 'Q01' });
  assert.equal(turn.report.status, 'ok');
  assert.equal(turn.report.error, null);
  assert.equal(turn.report.observations[0]?.code, 'CONCISION_TARGET_EXCEEDED');
  assert(turn.report.observations[0]!.actualWords > 100);
  const after = store.get(session.sessionId)!;
  assert.equal(after.version, before!.version + 1);
  assert.equal(after.session.consecutiveErrors, before!.session.consecutiveErrors);
  assert.equal(after.session.helpLevel, 'HINT');
  assert.equal(after.session.currentQuestion?.id, 'Q01');
});

test('error en transferencia con pista extensa pasa a IN_PROGRESS y cuenta el error', async () => {
  const { tutor, store, session, action } = setup('E4', (snapshot, input) => {
    const model = scenarioModel(snapshot, input);
    const generate = model._generate.bind(model);
    model._generate = async messages => {
      const result = await generate(messages);
      for (const generation of result.generations) {
        const call = (generation.message as AIMessage).tool_calls?.[0];
        if (call?.name === 'submitIntervention') call.args.intervention.message = 'idea '.repeat(101).trim();
      }
      return result;
    };
    return model;
  });
  const turn = await tutor.handleTurn(session.sessionId, action);
  assert.equal(turn.report.status, 'ok');
  assert.equal(turn.report.observations[0]?.rule, 'RP09');
  const saved = store.get(session.sessionId)!.session;
  assert.equal(saved.comprehension, 'IN_PROGRESS');
  assert.equal(saved.consecutiveErrors, 1);
  assert.equal(saved.helpLevel, 'HINT');
  assert.equal(saved.currentQuestion?.id, 'Q03');
  assert.equal(saved.history.at(-1)?.result, 'INCORRECT');
});
test('E1–E5: transición pedagógica completa y única confirmación por turno', async () => {
  for (const id of scenarioIds) {
    const { tutor, store, session, action } = setup(id);
    const turn = await tutor.handleTurn(session.sessionId, action, id);
    assert.equal(turn.report.status, 'ok', JSON.stringify(turn.report.error));
    const saved = store.get(session.sessionId)!;
    assert.equal(saved.version, 2);
    assert.equal(saved.session.history.length, session.history.length + 1);
    assert.deepEqual(saved.session.history.slice(0, session.history.length), session.history);
    assert.doesNotMatch(JSON.stringify(turn.response), /correctOptionId|privateRationale/);
    if (id === 'E1') {
      assert.equal(saved.session.comprehension, 'PENDING_VERIFICATION');
      assert.equal(saved.session.currentQuestion?.questionType, 'TRANSFER');
    } else if (id === 'E2') {
      assert.equal(saved.session.consecutiveErrors, 1); assert.equal(saved.session.helpLevel, 'HINT');
      assert.equal(saved.session.currentQuestion?.id, 'Q01');
    } else if (id === 'E3') {
      assert.equal(saved.session.consecutiveErrors, 2); assert.equal(saved.session.helpLevel, 'EXPLANATION');
      assert.equal(saved.session.currentQuestion?.questionType, 'SIMPLIFIED'); assert.equal(saved.session.currentQuestion?.difficulty, 'LOW');
    } else if (id === 'E4') {
      assert.equal(saved.session.comprehension, 'IN_PROGRESS'); assert.equal(saved.session.consecutiveErrors, 1);
    } else {
      assert.equal(saved.session.topicId, 'scrum-events'); assert.equal(saved.session.consecutiveErrors, 0);
      assert.equal(saved.session.helpLevel, 'NONE'); assert.equal(saved.session.comprehension, 'UNASSESSED');
      assert.equal(saved.session.conceptId, 'daily-scrum');
    }
  }
});
test('RP01: inicio sin tema presenta exactamente tres temas y no inventa pregunta', async () => {
  const tutor = new TurnCoordinator(new MemorySessionStore(), scenarioModel, { model: 'mock', mode: 'mock' });
  const result = await tutor.startSession('start');
  assert.equal(result.report.status, 'ok'); assert.equal(result.response.topics.length, 3);
  assert.equal(result.response.question, null); assert.equal(result.report.simulatedModelCalls, 1);
});
test('entrada inválida o pregunta obsoleta no llama al modelo ni modifica estado', async () => {
  const { tutor, store, session } = setup(); const before = store.get(session.sessionId);
  for (const action of ['B', { action: 'ANSWER', questionId: 'stale', selectedOptionId: 'A' },
    { action: 'CHANGE_TOPIC', targetTopicId: 'unknown' }, { action: 'ANSWER', questionId: 'Q01', selectedOptionId: 'D' }]) {
    const turn = await tutor.handleTurn(session.sessionId, action);
    assert.equal(turn.report.status, 'invalid_action'); assert.equal(turn.report.simulatedModelCalls, 0);
    assert.deepEqual(store.get(session.sessionId), before);
  }
});
test('REQUEST_HINT conserva errores, evidencia y pregunta', async () => {
  const { tutor, store, session } = setup('E4');
  const turn = await tutor.handleTurn(session.sessionId, { action: 'REQUEST_HINT', questionId: 'Q03' });
  assert.equal(turn.report.status, 'ok');
  const saved = store.get(session.sessionId)!.session;
  assert.equal(saved.consecutiveErrors, 0); assert.equal(saved.comprehension, 'PENDING_VERIFICATION');
  assert.equal(saved.currentQuestion?.id, 'Q03');
});
test('acierto en transferencia con evidencia previa verifica la comprensión', async () => {
  const { tutor, store, session } = setup('E4');
  const turn = await tutor.handleTurn(session.sessionId, { action: 'ANSWER', questionId: 'Q03', selectedOptionId: 'B' });
  assert.equal(turn.report.status, 'ok'); assert.equal(store.get(session.sessionId)!.session.comprehension, 'VERIFIED');
});
test('fallo del proveedor, diagnóstico falso y fuga explícita nunca confirman estado', async () => {
  const factories: ModelFactory[] = [
    () => new ScriptedModel([new Error('provider-failed')]),
    () => new ScriptedModel([{ name: 'checkAnswer', args: {} }, { name: 'handoffToAnalyst', args: {
      diagnosis: { result: 'INCORRECT', evidence: 'PARTIAL', difficultyDetected: null, requiresVerification: true }, reason: 'Diagnóstico incorrecto simulado para comprobar protección.' } }]),
    () => new ScriptedModel([{ name: 'checkAnswer', args: {} }, { name: 'handoffToAnalyst', args: {
      diagnosis: { result: 'CORRECT', evidence: 'PARTIAL', difficultyDetected: null, requiresVerification: true }, reason: 'Acierto sin transferencia previa en el historial.' } },
    { name: 'handoffToTutor', args: { strategyDecision: decision('VERIFY'), reason: 'Comprobar transferencia en otra situación.' } },
    { name: 'submitIntervention', args: { intervention: { ...mockGeneration('VERIFY'), message: 'La respuesta correcta es C.' } } }]),
  ];
  for (const factory of factories) {
    const { tutor, store, session, action } = setup('E1', factory); const before = store.get(session.sessionId);
    const turn = await tutor.handleTurn(session.sessionId, action);
    assert.equal(turn.report.status, 'error'); assert.deepEqual(store.get(session.sessionId), before);
    assert.doesNotMatch(JSON.stringify(turn.response), /provider-failed|correcta es C/);
  }
});
test('salida inválida admite un único reintento, medido y sin commit si persiste', async () => {
  const { tutor, store, session, action } = setup('E1', () => new ScriptedModel([
    () => new AIMessage('texto libre'), () => new AIMessage('texto libre otra vez'),
  ]));
  const before = store.get(session.sessionId);
  const turn = await tutor.handleTurn(session.sessionId, action);
  assert.equal(turn.report.status, 'error'); assert.equal(turn.report.technicalRetries, 1);
  assert.equal(turn.report.simulatedModelCalls, 2); assert.deepEqual(store.get(session.sessionId), before);
});
