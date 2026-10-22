import { readFileSync } from 'node:fs';
import { parseMaterial } from './load-material.js';
import { createHash } from 'node:crypto';

// Ruta relativa al módulo; se carga una sola vez al iniciar la sesión.
export const corpus = parseMaterial(readFileSync(new URL('../../scrum.md', import.meta.url), 'utf8'));
export const corpusHash = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
export const topics = corpus.sections.map(({ id, title }) => ({ id, title }));
export function getContext(topicId: string | null) {
  return topicId ? corpus.sections.filter(s => s.id === topicId) : corpus.sections;
}
export function validConcept(topicId: string, conceptId: string) {
  return getContext(topicId).some(s => (s.concepts as readonly string[]).includes(conceptId));
}
