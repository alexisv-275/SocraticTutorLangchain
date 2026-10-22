import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StudentActionSchema, StudySessionSchema, publicResponse } from '../domain/contracts.js';
import { scenario, scenarioIds, questions } from '../fixtures/scenarios.js';
import { topics } from '../academic/corpus.js';

test('E1–E5 conservan claves, acciones y snapshots independientes', () => {
  for (const id of scenarioIds) {
    const fixture = scenario(id);
    StudySessionSchema.parse(fixture.session);
    StudentActionSchema.parse(fixture.action);
  }
  assert.deepEqual(Object.values(questions).map(q => q.correctOptionId), ['B', 'C', 'B']);
  scenario('E3').session.history.length = 0;
  assert.equal(scenario('E3').session.history.length, 1);
  assert.equal(topics.length, 3);
});
test('entrada estricta: no texto libre, opciones inexistentes ni campos adicionales', () => {
  for (const input of ['B', { action: 'ANSWER', questionId: 'Q01', selectedOptionId: 'D' },
    { action: 'ANSWER', selectedOptionId: 'B' }, { action: 'REQUEST_HINT', questionId: 'Q01', selectedOptionId: 'B' }]) {
    assert.equal(StudentActionSchema.safeParse(input).success, false);
  }
});
test('salida pública excluye clave y justificación y agrega acciones 4/5', () => {
  const output = publicResponse('Inténtalo.', questions.Q01);
  assert.doesNotMatch(JSON.stringify(output), /correctOptionId|privateRationale/);
  assert.deepEqual(output.actions.map(a => a.id), ['4', '5']);
});
