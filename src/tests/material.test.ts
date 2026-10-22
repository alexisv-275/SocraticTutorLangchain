import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMaterial } from '../academic/load-material.js';
import { agentContext } from '../graph/study-graph.js';
import { scenario } from '../fixtures/scenarios.js';

const material = readFileSync(new URL('../../scrum.md', import.meta.url), 'utf8');
test('material aportado llega al contexto del Tutor y los cambios alteran su hash', () => {
  const corpus = parseMaterial(material);
  const f = scenario('E5');
  const context = agentContext({ action: f.action, sessionSnapshot: f.session, activeAgent: 'tutor_agent',
    handoffCount: 0, agentActivationCount: 0, lastHandoffReason: '', finished: false, handoffMessages: [] }, 'tutor_agent');
  assert.match(JSON.stringify(context), /15 minutos/);
  assert.match(corpus.sections[0]!.text, /conserva la responsabilidad/);
  assert.match(corpus.sections[2]!.text, /Definition of Done/);
  assert.notEqual(corpus.sourceHash, parseMaterial(material + '\nCambio de material.').sourceHash);
});
test('secciones ausentes o duplicadas fallan explícitamente', () => {
  assert.throws(() => parseMaterial('# Vacío'), /falta contenido/);
  assert.throws(() => parseMaterial(material + '\n## 2. Repetida\nTexto'), /duplicada/);
});
