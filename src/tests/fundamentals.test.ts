import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fundamentalsConcept, questionFocus } from '../academic/fundamentals.js';
import { createLibraryRetriever } from '../academic/retrieve-library.js';
import { ScriptedModel, toolMessage, type MockStep } from '../fixtures/mock-model.js';
import { createPractice } from '../web/practice.js';

for (const scoped of [false, true]) test(`Fundamentos usa el RAG durante toda la sesión ${scoped ? 'con archivo' : 'por tema'}`, async () => {
  const retrieved: string[] = [];
  const topic = 'Riego de un huerto';
  const source = 'material-academico/jardineria/huerto.md';
  const env = {
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'mock-server-key',
    VOYAGEAI_API_KEY: 'mock-voyage-key',
  };
  const retrieve = createLibraryRetriever(env, async (input, init) => {
    const body = JSON.parse(init!.body as string);
    if (String(input).startsWith('https://api.voyageai.com/')) {
      assert.equal(body.input_type, 'query');
      assert.equal(body.model, 'voyage-4');
      retrieved.push(body.input[0]);
      return Response.json({ data: [{ index: 0, embedding: Array(1024).fill(0.01) }] });
    }
    const rpc = scoped ? 'thinkagora_buscar_material' : 'thinkagora_buscar_biblioteca';
    assert.equal(new URL(String(input)).pathname, `/rest/v1/rpc/${rpc}`);
    assert.deepEqual(Object.keys(body), scoped ? ['p_embedding', 'p_source'] : ['p_embedding']);
    if (scoped) assert.equal(body.p_source, source);
    assert.equal(JSON.parse(body.p_embedding).length, 1024);
    return Response.json([{
      source, heading: 'Markdown', chunk_position: 1,
      content: 'Evidencia del RAG: comprobar la humedad del sustrato.',
    }]);
  });
  const intervention = (index: number): MockStep => messages => {
    const next = questionFocus[index];
    const context = messages.map(message => String(message.content)).join(' ');
    assert.match(context, /Evidencia del RAG/u);
    if (!next) return toolMessage('submitIntervention', {
      intervention: { kind: 'HINT', message: 'Observa el supuesto de la hipótesis.', topics: null, question: null },
    });
    assert.ok(context.includes(next));
    return toolMessage('submitIntervention', { intervention: {
      kind: 'QUESTION', message: 'Considera lo que propone el documento.', topics: null, question: {
        text: `¿Qué propone el documento en el caso ${index + 1}?`,
        options: { A: 'Una equivalencia.', B: 'Una fotografía.', C: 'Una ley probada.', D: 'Una huella.' },
        correctOptionId: 'D', privateRationale: 'Justificación reservada.',
        difficulty: 'LOW', questionType: 'INITIAL', conceptId: fundamentalsConcept,
      },
    } });
  };
  const search = (index: number): MockStep => messages => {
    assert.ok(messages.some(message => String(message.content).includes(topic)));
    return toolMessage('searchLibrary', { query: `${topic}, concepto ${index + 1}` });
  };
  const steps: MockStep[] = [search(0), intervention(0)];
  for (let index = 0; index < questionFocus.length; index++) {
    const correct = index !== 1;
    steps.push({ name: 'checkAnswer', args: {} }, { name: 'handoffToAnalyst', args: {
      diagnosis: { result: correct || scoped ? 'CORRECT' : 'INCORRECT', evidence: scoped ? 'CONSISTENT' : 'PARTIAL',
        difficultyDetected: null, requiresVerification: true },
      reason: 'El diagnóstico usa la evidencia del documento.',
    } }, messages => {
      const context = messages.findLast(message => message.type === 'human');
      assert.deepEqual(JSON.parse(String(context?.content)).diagnosis, {
        result: correct ? 'CORRECT' : 'INCORRECT', evidence: correct ? 'PARTIAL' : 'INSUFFICIENT',
        difficultyDetected: null, requiresVerification: false,
      });
      return toolMessage('handoffToTutor', {
        strategyDecision: { strategy: index === 5 ? 'CHECKPOINT' : correct ? 'DEEPEN' : 'SIMPLIFY',
          difficulty: 'LOW', justification: 'La pregunta se mantiene en Fundamentos.' },
        reason: 'Continuar con la próxima pregunta de Fundamentos.',
      });
    });
    if (index < questionFocus.length - 1) steps.push(search(index + 1));
    steps.push(intervention(index + 1));
  }
  const practice = createPractice(new ScriptedModel(steps), retrieve, 'mock', 10000);
  const start = await practice.start(topic, scoped ? source : undefined);
  let turn = start.turn;
  for (let index = 0; index < questionFocus.length; index++) {
    assert.equal(turn.number, index + 1);
    assert.equal(turn.question.questionType, 'INITIAL');
    assert.deepEqual(Object.keys(turn.question.options), ['A', 'B', 'C', 'D']);
    assert.equal(turn.topic, topic);
    assert.deepEqual(turn.sources, [{ source, headings: ['Markdown'] }]);
    assert.ok(!('correctOptionId' in turn.question));
    const result = await practice.answer({ sessionId: start.sessionId, questionId: turn.question.id, option: index === 1 ? 'A' : 'D' });
    assert.equal(result.correct, index !== 1);
    if (index === 5) assert.equal(result.next, null);
    else {
      assert.ok(result.next);
      turn = result.next;
    }
  }
  assert.deepEqual(retrieved, questionFocus.map((_, index) => `${topic}, concepto ${index + 1}`));
});
