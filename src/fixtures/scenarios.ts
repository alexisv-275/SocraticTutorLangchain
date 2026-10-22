import type { Question, StudentAction, StudySession } from '../domain/contracts.js';

export const questions: Record<'Q01' | 'Q02' | 'Q03', Question> = {
  Q01: { id: 'Q01', text: 'En Scrum, ¿quién es responsable de maximizar el valor del producto?',
    options: { A: 'Developers.', B: 'Product Owner.', C: 'Scrum Master.' }, correctOptionId: 'B',
    privateRationale: 'El Product Owner responde por maximizar el valor.', questionType: 'INITIAL', difficulty: 'LOW', conceptId: 'product-owner' },
  Q02: { id: 'Q02', text: 'Varios interesados solicitan funcionalidades diferentes. ¿Quién responde por la gestión efectiva del Product Backlog?',
    options: { A: 'Scrum Master.', B: 'Developers.', C: 'Product Owner.' }, correctOptionId: 'C',
    privateRationale: 'La gestión efectiva del Product Backlog corresponde al Product Owner.', questionType: 'REFORMULATION', difficulty: 'MEDIUM', conceptId: 'product-owner' },
  Q03: { id: 'Q03', text: 'Dos funcionalidades compiten por prioridad: una es la más solicitada y otra parece aportar más valor. ¿Qué actuación corresponde mejor con Scrum?',
    options: { A: 'Implementar siempre la más solicitada.', B: 'El Product Owner evalúa el valor y ordena el Product Backlog.', C: 'El Scrum Master decide unilateralmente la prioridad.' }, correctOptionId: 'B',
    privateRationale: 'El Product Owner ordena atendiendo al valor.', questionType: 'TRANSFER', difficulty: 'MEDIUM', conceptId: 'product-owner' },
};
export function baseSession(sessionId = 'test-session'): StudySession {
  return { sessionId, topicId: 'scrum-roles', conceptId: 'product-owner', currentQuestion: structuredClone(questions.Q01),
    consecutiveErrors: 0, helpLevel: 'NONE', comprehension: 'UNASSESSED', history: [] };
}
export function emptySession(sessionId: string): StudySession {
  return { ...baseSession(sessionId), topicId: null, conceptId: null, currentQuestion: null };
}
function priorAnswer(correct: boolean): StudySession['history'][number] {
  return { topicId: 'scrum-roles', conceptId: 'product-owner', questionId: 'Q01', questionType: 'INITIAL',
    selectedOptionId: correct ? 'B' : 'A', result: correct ? 'CORRECT' : 'INCORRECT',
    strategy: correct ? 'VERIFY' : 'HINT', helpLevel: correct ? 'NONE' : 'HINT' };
}
export const scenarioIds = ['E1', 'E2', 'E3', 'E4', 'E5'] as const;
export type ScenarioId = typeof scenarioIds[number];
export function scenario(id: ScenarioId): { session: StudySession; action: StudentAction } {
  const session = baseSession();
  if (id === 'E3' || id === 'E5') Object.assign(session, {
    currentQuestion: structuredClone(questions.Q02), consecutiveErrors: 1, helpLevel: 'HINT',
    comprehension: 'IN_PROGRESS', history: [priorAnswer(false)],
  });
  if (id === 'E4') Object.assign(session, { currentQuestion: structuredClone(questions.Q03),
    comprehension: 'PENDING_VERIFICATION', history: [priorAnswer(true)] });
  const action: StudentAction = id === 'E5' ? { action: 'CHANGE_TOPIC', targetTopicId: 'scrum-events' }
    : { action: 'ANSWER', questionId: session.currentQuestion!.id, selectedOptionId: id === 'E1' ? 'B' : 'A' };
  return { session, action };
}
