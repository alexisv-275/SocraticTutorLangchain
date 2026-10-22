import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import { getContext } from '../academic/corpus.js';
import { requiredStrategy } from '../domain/policy.js';
import { createDiagnosticAgent } from '../agents/diagnostic.js';
import { createAnalystAgent } from '../agents/analyst.js';
import { createTutorAgent } from '../agents/tutor.js';
import { LIMITS } from '../config/limits.js';
import { ensure } from '../domain/errors.js';
import type { MetricsCollector } from '../infrastructure/metrics.js';
import type { AgentRole, GraphTurnState } from './state.js';
import type { TurnRuntime } from './handoffs.js';

const GraphState = Annotation.Root({ turn: Annotation<GraphTurnState>() });

export function agentContext(s: GraphTurnState, role: AgentRole) {
  const session = s.sessionSnapshot;
  const topicId = s.action?.action === 'CHANGE_TOPIC' ? s.action.targetTopicId : session.topicId;
  // Al cambiar tema no arrastrar preguntas del tema anterior al contenido del Tutor.
  const changing = s.action?.action === 'CHANGE_TOPIC';
  const common = { action: s.action, topicId, conceptId: changing ? null : session.conceptId,
    consecutiveErrors: changing ? 0 : session.consecutiveErrors,
    comprehension: changing ? 'UNASSESSED' : session.comprehension, helpLevel: changing ? 'NONE' : session.helpLevel,
    lastHandoffReason: s.lastHandoffReason, remainingActivations: LIMITS.agentActivations - s.agentActivationCount,
    remainingHandoffs: LIMITS.handoffs - s.handoffCount };
  const history = session.history.filter(h => h.conceptId === session.conceptId).slice(-6);
  if (role === 'diagnostic_agent') return { ...common, question: session.currentQuestion, history };
  if (role === 'analyst_agent') return { ...common, requiredStrategy: requiredStrategy(session, s.action), diagnosis: s.diagnosis, history: changing ? [] : history,
    questionType: changing ? null : session.currentQuestion?.questionType, previousStrategy: s.strategyDecision };
  return { ...common, strategyDecision: s.strategyDecision, previousQuestion: changing ? null : session.currentQuestion,
    academicData: getContext(topicId) };
}

export function createStudyGraph(model: BaseChatModel, initial: GraphTurnState, metrics: MetricsCollector) {
  const runtime: TurnRuntime = { current: initial, checkedAnswer: false, metrics };
  const agents = { diagnostic_agent: createDiagnosticAgent(model, runtime), analyst_agent: createAnalystAgent(model, runtime), tutor_agent: createTutorAgent(model, runtime) };
  const node = (role: AgentRole) => async (state: typeof GraphState.State, config: RunnableConfig) => {
    ensure(state.turn.agentActivationCount < LIMITS.agentActivations, 'ACTIVATION_BUDGET', 'Se agotaron las activaciones.');
    runtime.current = { ...state.turn, activeAgent: role, agentActivationCount: state.turn.agentActivationCount + 1 };
    runtime.checkedAnswer = false;
    metrics.agentTrace.push({ role, activation: runtime.current.agentActivationCount, time: new Date().toISOString() });
    await agents[role].invoke({ messages: [new HumanMessage(JSON.stringify(agentContext(runtime.current, role)))] }, {
      ...config, callbacks: [metrics.callbacks(role)], recursionLimit: LIMITS.recursionLimit,
    });
    // Command.PARENT sale del subgrafo. Un retorno normal carece de entrega tipada.
    throw new Error('El agente terminó sin transferencia ni intervención.');
  };
  return new StateGraph(GraphState)
    .addNode('diagnostic_agent', node('diagnostic_agent'), { ends: ['analyst_agent'] })
    .addNode('analyst_agent', node('analyst_agent'), { ends: ['diagnostic_agent', 'tutor_agent'] })
    .addNode('tutor_agent', node('tutor_agent'), { ends: ['analyst_agent', END] })
    .addConditionalEdges(START, state => state.turn.activeAgent, ['diagnostic_agent', 'analyst_agent', 'tutor_agent'])
    .compile();
}
