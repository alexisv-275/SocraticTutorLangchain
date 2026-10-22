import { randomUUID } from 'node:crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { corpus, corpusHash } from '../academic/corpus.js';
import { LIMITS } from '../config/limits.js';
import { StudentActionSchema, StudySessionSchema, publicResponse, type StudentAction, type StudySession } from '../domain/contracts.js';
import { ensure, TurnError } from '../domain/errors.js';
import { checkAnswer, hasTransferEvidence, validateAction, validateDiagnosis, validateGeneration, validateStrategy } from '../domain/policy.js';
import { emptySession } from '../fixtures/scenarios.js';
import { createStudyGraph } from '../graph/study-graph.js';
import type { GraphTurnState } from '../graph/state.js';
import { MemorySessionStore } from '../infrastructure/memory-store.js';
import { MetricsCollector } from '../infrastructure/metrics.js';

export type ModelFactory = (session: StudySession, action: StudentAction | null) => BaseChatModel;
export type CoordinatorOptions = { model: string; mode: 'live' | 'mock'; timeoutMs?: number; effectiveConfig?: Record<string, unknown> };
// Solo registrar mensajes de nuestras validaciones; nunca cuerpos del proveedor.
function validationDetail(error: unknown): string | null {
  if (error instanceof TurnError) return error.message;
  const cause = (error as { cause?: unknown })?.cause;
  return cause && cause !== error ? validationDetail(cause) : null;
}
function errorCode(error: unknown): string {
  if (error instanceof TurnError) return error.code;
  if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') return 'TIMEOUT';
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return 'AUTHENTICATION';
  if (status === 429) return 'RATE_LIMIT';
  if (status && status >= 500) return 'PROVIDER_UNAVAILABLE';
  if ((error as { cause?: unknown })?.cause) return errorCode((error as { cause: unknown }).cause);
  return 'TURN_FAILED';
}
function stateSummary(s: StudySession) {
  return { topicId: s.topicId, conceptId: s.conceptId, consecutiveErrors: s.consecutiveErrors,
    helpLevel: s.helpLevel, comprehension: s.comprehension, history: s.history,
    currentQuestion: s.currentQuestion ? publicResponse('', s.currentQuestion).question : null };
}
export class TurnCoordinator {
  constructor(readonly store: MemorySessionStore, private modelFactory: ModelFactory, private options: CoordinatorOptions) {}
  startSession(sessionId: string = randomUUID()) { return this.run(sessionId, null, 'START', true); }
  handleTurn(sessionId: string, action: unknown, scenarioId: string | null = null) { return this.run(sessionId, action, scenarioId, false); }

  private async run(sessionId: string, input: unknown, scenarioId: string | null, starting: boolean) {
    const metrics = new MetricsCollector(this.options.model, this.options.mode);
    const stored = this.store.get(sessionId);
    const session = stored?.session ?? emptySession(sessionId);
    let status: 'ok' | 'invalid_action' | 'error' = 'error';
    let response = publicResponse('No se pudo completar el turno. Puedes volver a intentarlo.', null);
    let error: { code: string; message: string; validationDetail: string | null } | null = null;
    let final: GraphTurnState | undefined;
    try {
      ensure(starting ? !stored : stored, 'INVALID_ACTION', starting ? 'Esta sesión ya existe.' : 'Inicia una sesión primero.');
      const parsed = starting ? null : StudentActionSchema.safeParse(input);
      ensure(starting || parsed?.success, 'INVALID_ACTION', 'Selecciona A, B, C, 4 o 5 para la pregunta activa.');
      const action = parsed?.success ? parsed.data : null;
      if (action) validateAction(session, action);
      const initial: GraphTurnState = { action, sessionSnapshot: structuredClone(session),
        activeAgent: starting ? 'tutor_agent' : action?.action === 'ANSWER' ? 'diagnostic_agent' : 'analyst_agent',
        agentActivationCount: 0, handoffCount: 0, lastHandoffReason: '', handoffMessages: [], finished: false,
        ...(starting ? { strategyDecision: { strategy: 'START_TOPIC' as const, difficulty: 'LOW' as const, justification: 'Sesión sin tema activo.' } } : {}),
      };
      const signal = AbortSignal.timeout(this.options.timeoutMs ?? 180000);
      const graph = createStudyGraph(this.modelFactory(session, action), initial, metrics);
      const output = await graph.invoke({ turn: initial }, { recursionLimit: LIMITS.recursionLimit, signal });
      signal.throwIfAborted();
      final = output.turn;
      const next = this.commitCandidate(final);
      const generation = final.tutorGeneration!;
      response = publicResponse(generation.message, next.currentQuestion, generation.topics ?? []);
      // Única escritura del turno: todas las validaciones deben haber terminado.
      this.store.save(next, stored?.version ?? 0);
      status = 'ok';
    } catch (cause) {
      const code = errorCode(cause);
      status = code === 'INVALID_ACTION' ? 'invalid_action' : 'error';
      const message = cause instanceof TurnError && code === 'INVALID_ACTION' ? cause.message
        : code === 'AUTHENTICATION' ? 'Revisa ANTHROPIC_API_KEY y el acceso al modelo en .env.'
          : code === 'CONFIGURATION' ? (cause as Error).message
            : 'El turno no se confirmó. Puedes volver a intentarlo; tu progreso se conserva.';
      error = { code, message, validationDetail: validationDetail(cause) };
      response = publicResponse(message, session.currentQuestion);
    }
    const after = this.store.get(sessionId)?.session ?? session;
    // RP09 es un objetivo de concisión: observar el exceso, sin deshacer un turno válido.
    const visibleText = [response.message, response.question?.text,
      ...Object.values(response.question?.options ?? {}), ...response.topics.map(t => t.title)].filter(Boolean).join(' ');
    const visibleWordCount = visibleText.trim() ? visibleText.trim().split(/\s+/u).length : 0;
    const observations = status === 'ok' && visibleWordCount > 100
      ? [{ code: 'CONCISION_TARGET_EXCEEDED', rule: 'RP09', targetWords: 100, actualWords: visibleWordCount }]
      : [];
    const report = { ...metrics.finish(), sessionId, scenarioId, status,
      observations,
      result: status === 'ok' ? final?.diagnosis?.result ?? 'NOT_APPLICABLE' : null,
      strategy: status === 'ok' ? final?.strategyDecision?.strategy ?? null : null,
      pedagogicalDecision: status === 'ok' ? final?.strategyDecision ?? null : null,
      error, response, stateBefore: stateSummary(session), stateAfter: stateSummary(after),
      corpus: { id: corpus.id, sha256: corpusHash, source: corpus.source, sourceHash: corpus.sourceHash, status: corpus.status }, effectiveConfig: this.options.effectiveConfig ?? {},
      passedChecks: null, applicableChecks: scenarioId?.match(/^E[1-5]$/) ? 3 : null, criticalFailures: null,
      evaluationStatus: 'PENDING_MANUAL_REVIEW', notes: '',
    };
    return { sessionId, response, report };
  }

  private commitCandidate(s: GraphTurnState): StudySession {
    ensure(s.finished && s.tutorGeneration && s.strategyDecision, 'INCOMPLETE_TURN', 'Falta intervención completa.');
    const previous = s.sessionSnapshot;
    const action = s.action;
    if (action?.action === 'ANSWER') validateDiagnosis(previous, action, s.diagnosis);
    const decision = validateStrategy(previous, action, s.strategyDecision);
    const generation = validateGeneration(previous, action, decision, s.tutorGeneration);
    const next = structuredClone(previous);
    const result = checkAnswer(previous, action);
    if (action?.action === 'CHANGE_TOPIC') {
      Object.assign(next, { topicId: action.targetTopicId, conceptId: null, currentQuestion: null,
        consecutiveErrors: 0, helpLevel: 'NONE', comprehension: 'UNASSESSED' });
    } else if (action?.action === 'ANSWER') {
      next.consecutiveErrors = result === 'CORRECT' ? 0 : previous.consecutiveErrors + 1;
      next.comprehension = result === 'INCORRECT' ? 'IN_PROGRESS'
        : hasTransferEvidence(previous, action) ? 'VERIFIED' : 'PENDING_VERIFICATION';
      next.helpLevel = result === 'CORRECT' ? 'NONE' : decision.strategy === 'SIMPLIFY' ? 'EXPLANATION' : 'HINT';
    } else if (action?.action === 'REQUEST_HINT') next.helpLevel = 'HINT';
    if (generation.question) {
      next.currentQuestion = { ...generation.question, id: `q-${randomUUID()}` };
      next.conceptId = generation.question.conceptId;
    }
    if (action) next.history.push({ topicId: previous.topicId, conceptId: previous.conceptId,
      questionId: previous.currentQuestion?.id ?? null, questionType: previous.currentQuestion?.questionType ?? null,
      selectedOptionId: action.action === 'ANSWER' ? action.selectedOptionId : null,
      result, strategy: decision.strategy, helpLevel: next.helpLevel });
    return StudySessionSchema.parse(next);
  }
}
export type TurnResult = Awaited<ReturnType<TurnCoordinator['handleTurn']>>;
