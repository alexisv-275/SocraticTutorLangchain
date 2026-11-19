import { randomUUID } from 'node:crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { questionFocus, type GroundedQuestion, type PracticeContext } from '../academic/fundamentals.js';
import type { RetrieveLibrary } from '../academic/retrieve-library.js';
import { LIMITS } from '../config/limits.js';
import { PracticeOptionId, publicResponse, type Question, type TutorAction, type StudySession } from '../domain/contracts.js';
import { ensure } from '../domain/errors.js';
import { checkAnswer, validateAction } from '../domain/policy.js';
import { emptySession } from '../fixtures/scenarios.js';
import type { GraphTurnState } from '../graph/state.js';
import { createStudyGraph } from '../graph/study-graph.js';
import { MetricsCollector } from '../infrastructure/metrics.js';

export const AnswerInput = z.object({
  sessionId: z.uuid(), questionId: z.uuid(), option: PracticeOptionId,
}).strict();
export const StartInput = z.object({
  topic: z.string().trim().min(1).max(160).optional(), uploadId: z.uuid().optional(),
}).strict().refine(input => input.topic !== undefined || input.uploadId !== undefined);

type Item = { question: Question; evidence: GroundedQuestion };
type Session = { topic: string; source?: string; index: number; item: Item | null; busy: boolean; expires: number };
const total = questionFocus.length;
const timeout = 60 * 60 * 1000;

export function createPractice(model: BaseChatModel, retrieve: RetrieveLibrary, modelName: string, turnTimeoutMs: number) {
  const sessions = new Map<string, Session>();

  async function run(sessionSnapshot: StudySession, action: TutorAction | null, practice: PracticeContext, source?: string) {
    const initial: GraphTurnState = {
      sessionSnapshot, action, practice, activeAgent: action ? 'diagnostic_agent' : 'tutor_agent',
      agentActivationCount: 0, handoffCount: 0, lastHandoffReason: '', handoffMessages: [], finished: false,
      ...(action ? {} : { strategyDecision: { strategy: 'START_TOPIC', difficulty: 'LOW', justification: 'Inicia Fundamentos.' } }),
    };
    const metrics = new MetricsCollector(modelName, 'live');
    const graph = createStudyGraph(model, initial, metrics, query => retrieve(query, source));
    const signal = AbortSignal.timeout(turnTimeoutMs);
    const result = await graph.invoke({ turn: initial }, { recursionLimit: LIMITS.recursionLimit, signal });
    signal.throwIfAborted();
    ensure(result.turn.finished && result.turn.tutorGeneration, 'INCOMPLETE_TURN', 'El tutor no completó la pregunta.');
    const proposed = result.turn.tutorGeneration.question;
    const evidence = result.turn.practice?.next;
    const item = proposed && evidence ? { question: { ...proposed, id: randomUUID() }, evidence } : null;
    return { item, feedback: result.turn.tutorGeneration.message };
  }

  function plan(topic: string, index: number): GroundedQuestion | null {
    const focus = questionFocus[index];
    return focus ? { topic, focus, excerpts: [] } : null;
  }

  function present(item: Item, index: number) {
    const { evidence, question } = item;
    const sources = new Map<string, Set<string>>();
    for (const row of evidence.excerpts) {
      const headings = sources.get(row.source) ?? new Set<string>();
      headings.add(row.heading);
      sources.set(row.source, headings);
    }
    return {
      number: index + 1, total, topic: evidence.topic, focus: evidence.focus,
      question: publicResponse('', question).question!,
      sources: [...sources].map(([source, headings]) => ({ source, headings: [...headings] })),
    };
  }

  return {
    async start(topic: string, source?: string) {
      const now = Date.now();
      for (const [id, session] of sessions) if (!session.busy && session.expires <= now) sessions.delete(id);
      ensure(sessions.size < 100, 'BUSY', 'Hay demasiadas prácticas abiertas. Intenta más tarde.');
      const sessionId = randomUUID();
      const session: Session = { topic, source, index: 0, item: null, busy: true, expires: now + timeout };
      sessions.set(sessionId, session);
      try {
        const { item } = await run(emptySession(sessionId), null, { current: null, next: plan(topic, 0) }, source);
        ensure(item, 'INCOMPLETE_TURN', 'El tutor no generó la primera pregunta.');
        session.item = item;
        return { sessionId, turn: present(item, 0) };
      } catch (error) {
        sessions.delete(sessionId);
        throw error;
      } finally {
        session.busy = false;
      }
    },

    async answer(input: z.infer<typeof AnswerInput>) {
      const session = sessions.get(input.sessionId);
      ensure(session && session.expires > Date.now(), 'SESSION_EXPIRED', 'La práctica expiró. Vuelve a pulsar Start.');
      ensure(!session.busy, 'BUSY', 'La respuesta ya está en proceso.');
      const current = session.item;
      ensure(current && current.question.id === input.questionId, 'INVALID_ACTION', 'Responde a la pregunta activa.');
      const action = { action: 'ANSWER', questionId: input.questionId, selectedOptionId: input.option } as const;
      const snapshot = {
        ...emptySession(input.sessionId), topicId: session.topic,
        conceptId: current.question.conceptId, currentQuestion: current.question,
      };
      validateAction(snapshot, action);
      session.busy = true;
      try {
        const correct = checkAnswer(snapshot, action) === 'CORRECT';
        const { item, feedback } = await run(snapshot, action, {
          current: current.evidence, next: plan(session.topic, session.index + 1),
        }, session.source);
        session.index += 1;
        session.item = item;
        session.expires = Date.now() + timeout;
        return { correct, feedback, next: item ? present(item, session.index) : null };
      } finally {
        session.busy = false;
      }
    },
  };
}
