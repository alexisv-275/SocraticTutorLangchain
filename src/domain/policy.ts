import { topics, validConcept } from '../academic/corpus.js';
import { type Diagnosis, type TutorAction, type StudySession, type StrategyDecision,
  type TutorGeneration, DiagnosisSchema, StrategyDecisionSchema, TutorGenerationSchema } from './contracts.js';
import { ensure } from './errors.js';
import { fundamentalsConcept, type PracticeContext } from '../academic/fundamentals.js';

export function validateAction(session: StudySession, action: TutorAction) {
  if (action.action === 'CHANGE_TOPIC') {
    ensure(topics.some(t => t.id === action.targetTopicId), 'INVALID_ACTION', 'Selecciona un tema disponible.');
  } else {
    ensure(session.currentQuestion?.id === action.questionId, 'INVALID_ACTION', 'Responde a la pregunta activa.');
    if (action.action === 'ANSWER') {
      ensure(session.currentQuestion?.options[action.selectedOptionId], 'INVALID_ACTION', 'Selecciona una opción disponible.');
    }
  }
}
export function checkAnswer(session: StudySession, action: TutorAction | null): Diagnosis['result'] {
  if (action?.action !== 'ANSWER') return 'NOT_APPLICABLE';
  validateAction(session, action);
  return session.currentQuestion!.correctOptionId === action.selectedOptionId ? 'CORRECT' : 'INCORRECT';
}
export function hasTransferEvidence(session: StudySession, action: TutorAction | null) {
  return checkAnswer(session, action) === 'CORRECT' && session.currentQuestion?.questionType === 'TRANSFER'
    && ['PENDING_VERIFICATION', 'VERIFIED'].includes(session.comprehension)
    && session.history.some(h => h.conceptId === session.conceptId && h.result === 'CORRECT' && h.strategy === 'VERIFY');
}
export function validateDiagnosis(session: StudySession, action: TutorAction | null, value: unknown, practice?: PracticeContext): Diagnosis {
  const d = DiagnosisSchema.parse(value);
  const result = checkAnswer(session, action);
  if (practice) {
    return { ...d, result, evidence: result === 'CORRECT' ? 'PARTIAL' : 'INSUFFICIENT', requiresVerification: false };
  }
  ensure(d.result === result, 'INVALID_DIAGNOSIS', 'El diagnóstico contradice la clave objetiva.');
  ensure(d.evidence !== 'CONSISTENT' || hasTransferEvidence(session, action), 'INVALID_DIAGNOSIS', 'Falta evidencia positiva de transferencia.');
  ensure(d.result !== 'CORRECT' || hasTransferEvidence(session, action) || d.requiresVerification, 'INVALID_DIAGNOSIS', 'El acierto inicial exige verificación.');
  return d;
}
export function requiredStrategy(session: StudySession, action: TutorAction | null, practice?: PracticeContext): StrategyDecision['strategy'] {
  if (practice) {
    if (!action) return 'START_TOPIC';
    if (!practice.next) return 'CHECKPOINT';
    return checkAnswer(session, action) === 'CORRECT' ? 'DEEPEN' : 'SIMPLIFY';
  }
  if (!action) return 'START_TOPIC';
  if (action.action === 'CHANGE_TOPIC') return 'CHANGE_TOPIC';
  if (action.action === 'REQUEST_HINT') return 'HINT';
  if (checkAnswer(session, action) === 'CORRECT') return hasTransferEvidence(session, action) ? 'DEEPEN' : 'VERIFY';
  return session.consecutiveErrors + 1 >= 2 ? 'SIMPLIFY' : 'HINT';
}
export function validateStrategy(session: StudySession, action: TutorAction | null, value: unknown, practice?: PracticeContext) {
  const decision = StrategyDecisionSchema.parse(value);
  ensure(decision.strategy === requiredStrategy(session, action, practice), 'INVALID_STRATEGY', 'La estrategia contradice las reglas pedagógicas.');
  ensure(decision.strategy !== 'SIMPLIFY' || decision.difficulty === 'LOW', 'INVALID_STRATEGY', 'La simplificación exige dificultad LOW.');
  ensure(!practice || decision.difficulty === 'LOW', 'INVALID_STRATEGY', 'Fundamentos usa dificultad inicial.');
  return decision;
}
export function validateGeneration(session: StudySession, action: TutorAction | null, strategy: StrategyDecision, value: unknown, practice?: PracticeContext): TutorGeneration {
  const g = TutorGenerationSchema.parse(value);
  const q = g.question;
  if (practice) {
    g.topics = null;
    if (practice.next) {
      ensure(practice.next.excerpts.length, 'RAG_EMPTY', 'No se encontró material indexado sobre ese tema.');
      ensure(g.kind === 'QUESTION' && q && q.options.D,
        'INVALID_OUTPUT', 'La práctica requiere una pregunta con cuatro opciones.');
      ensure(q.text !== session.currentQuestion?.text, 'INVALID_OUTPUT', 'La siguiente pregunta debe ser distinta.');
      g.question = { ...q, conceptId: fundamentalsConcept, questionType: 'INITIAL', difficulty: 'LOW' };
    } else {
      ensure(g.kind === 'HINT' && !q, 'INVALID_OUTPUT', 'Al finalizar solo corresponde el feedback.');
    }
  } else if (strategy.strategy === 'START_TOPIC') {
    ensure(g.kind === 'TOPICS' && !q && g.topics?.length === 3
      && new Set(g.topics.map(t => t.id)).size === 3
      && g.topics.every(t => topics.some(known => known.id === t.id && known.title === t.title)),
    'INVALID_OUTPUT', 'El inicio exige los tres temas del material.');
  } else {
    ensure(g.topics === null, 'INVALID_OUTPUT', 'Solo el inicio ofrece el catálogo de temas.');
    if (strategy.strategy === 'HINT') {
      ensure(g.kind === 'HINT' && q === null && session.currentQuestion, 'INVALID_OUTPUT', 'Una pista conserva la pregunta activa.');
    } else {
      ensure(g.kind === 'QUESTION' && q, 'INVALID_OUTPUT', 'La estrategia exige una pregunta nueva.');
      ensure(!q.options.D && q.correctOptionId !== 'D', 'INVALID_OUTPUT', 'Esta sesión usa tres opciones.');
      const topicId = action?.action === 'CHANGE_TOPIC' ? action.targetTopicId : session.topicId;
      ensure(topicId && validConcept(topicId, q.conceptId), 'INVALID_OUTPUT', 'Concepto fuera del tema activo.');
      ensure(action?.action === 'CHANGE_TOPIC' || q.conceptId === session.conceptId, 'INVALID_OUTPUT', 'No cambiar el concepto durante su comprobación.');
      ensure(q.difficulty === strategy.difficulty, 'INVALID_OUTPUT', 'Dificultad incompatible con estrategia.');
      const expected = strategy.strategy === 'VERIFY' ? 'TRANSFER'
        : strategy.strategy === 'SIMPLIFY' ? 'SIMPLIFIED'
          : strategy.strategy === 'CHANGE_TOPIC' ? 'INITIAL' : 'TRANSFER';
      ensure(q.questionType === expected, 'INVALID_OUTPUT', 'Tipo de pregunta incompatible con estrategia.');
      ensure(q.text !== session.currentQuestion?.text, 'INVALID_OUTPUT', 'La comprobación debe ser nueva.');
    }
  }
  const publicQuestion = q ?? (strategy.strategy === 'HINT' ? session.currentQuestion : null);
  const visible = [g.message, publicQuestion?.text, ...Object.values(publicQuestion?.options ?? {}), ...(g.topics?.map(t => t.title) ?? [])].filter(Boolean).join(' ');
  // Barrera para fugas explícitas; la calidad semántica sigue requiriendo la rúbrica manual.
  ensure(!/correctOptionId|privateRationale|(?:respuesta|opción|alternativa|clave)\s+(?:correcta\s+)?(?:es\s+|:\s*)[ABCD]\b/iu.test(visible),
    'PRIVATE_LEAK', 'La salida contiene una clave explícita.');
  ensure(!/(?:has dominado|comprensión verificada|dominas (?:el|este)|dominio (?:completo|verificado))/iu.test(visible)
    || hasTransferEvidence(session, action), 'PREMATURE_MASTERY', 'No declarar dominio sin transferencia.');
  if (strategy.strategy === 'HINT' && session.currentQuestion) {
    const answer = session.currentQuestion.options[session.currentQuestion.correctOptionId]?.replace(/[.!?]+$/u, '').toLowerCase();
    ensure(answer && !g.message.toLowerCase().includes(answer), 'PRIVATE_LEAK', 'La pista revela el texto de la respuesta.');
  }
  return g;
}
