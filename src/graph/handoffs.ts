import { Command, END } from '@langchain/langgraph';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { z } from 'zod';
import { DiagnosisSchema, StrategyDecisionSchema, TutorGenerationSchema } from '../domain/contracts.js';
import { checkAnswer, validateDiagnosis, validateGeneration, validateStrategy } from '../domain/policy.js';
import { ensure, TurnError } from '../domain/errors.js';
import { LIMITS } from '../config/limits.js';
import type { MetricsCollector } from '../infrastructure/metrics.js';
import type { AgentRole, GraphTurnState } from './state.js';

export type TurnRuntime = { current: GraphTurnState; checkedAnswer: boolean; metrics: MetricsCollector };
const reasonSchema = z.string().trim().min(12).max(400);
export const toolSchemas = {
  checkAnswer: z.object({}).strict(),
  handoffToAnalyst: z.object({ diagnosis: DiagnosisSchema, reason: reasonSchema }).strict(),
  handoffToTutor: z.object({ strategyDecision: StrategyDecisionSchema, reason: reasonSchema }).strict(),
  requestRediagnosis: z.object({ reason: reasonSchema }).strict(),
  requestStrategyClarification: z.object({ reason: reasonSchema }).strict(),
  submitIntervention: z.object({ intervention: TutorGenerationSchema }).strict(),
};
const allowed: Record<AgentRole, AgentRole[]> = {
  diagnostic_agent: ['analyst_agent'], analyst_agent: ['diagnostic_agent', 'tutor_agent'], tutor_agent: ['analyst_agent'],
};

export function transfer(runtime: TurnRuntime, target: AgentRole, reason: string, update: Partial<GraphTurnState>, config: ToolRuntime) {
  const s = runtime.current;
  try {
    ensure(allowed[s.activeAgent].includes(target), 'INVALID_HANDOFF', 'Destino no permitido.');
    ensure(s.handoffCount < LIMITS.handoffs && s.agentActivationCount < LIMITS.agentActivations, 'HANDOFF_BUDGET', 'No queda presupuesto para otra transferencia.');
    ensure(!runtime.metrics.handoffs.some(h => h.accepted && h.fromAgent === s.activeAgent && h.toAgent === target && h.reason === reason), 'HANDOFF_CYCLE', 'Transferencia repetida sin nueva justificación.');
    if (target === 'diagnostic_agent') {
      ensure(s.action?.action === 'ANSWER', 'INVALID_HANDOFF', 'Solo se reevalúan respuestas.');
    }
    const last = (config.state as { messages: AIMessage[] }).messages.at(-1);
    ensure(last && AIMessage.isInstance(last) && last.tool_calls?.length === 1, 'INVALID_HANDOFF', 'La transferencia exige una sola llamada de herramienta.');
    // El par queda en el estado temporal; el siguiente agente recibe solo datos estructurados.
    const pair = [last, new ToolMessage({ content: 'Transferencia aceptada.', tool_call_id: config.toolCallId })];
    runtime.metrics.handoffs.push({ fromAgent: s.activeAgent, toAgent: target, reason, time: new Date().toISOString(), accepted: true });
    return new Command({ graph: Command.PARENT, goto: target, update: { turn: {
      ...s, ...update, activeAgent: target, handoffCount: s.handoffCount + 1, lastHandoffReason: reason, handoffMessages: pair,
    } } });
  } catch (error) {
    runtime.metrics.handoffs.push({ fromAgent: s.activeAgent, toAgent: target, reason, time: new Date().toISOString(), accepted: false,
      rejectionCode: error instanceof TurnError ? error.code : 'INVALID_HANDOFF' });
    throw error;
  }
}
export function diagnosticTools(runtime: TurnRuntime) {
  return [
    tool(() => {
      runtime.checkedAnswer = true;
      return { result: checkAnswer(runtime.current.sessionSnapshot, runtime.current.action) };
    }, { name: 'checkAnswer', description: 'Comprueba objetivamente la selección vigente contra la clave privada.', schema: toolSchemas.checkAnswer }),
    tool(({ diagnosis, reason }, config: ToolRuntime) => {
      ensure(runtime.checkedAnswer, 'UNCHECKED_ANSWER', 'Debes llamar checkAnswer antes de diagnosticar.');
      const s = runtime.current;
      const checked = validateDiagnosis(s.sessionSnapshot, s.action, diagnosis);
      return transfer(runtime, 'analyst_agent', reason, { diagnosis: checked }, config);
    }, { name: 'handoffToAnalyst', description: 'Entrega el diagnóstico validado y cede control al Analista.', schema: toolSchemas.handoffToAnalyst }),
  ];
}
export function analystTools(runtime: TurnRuntime) {
  return [
    tool(({ strategyDecision, reason }, config: ToolRuntime) => {
      const s = runtime.current;
      const checked = validateStrategy(s.sessionSnapshot, s.action, strategyDecision);
      return transfer(runtime, 'tutor_agent', reason, { strategyDecision: checked }, config);
    }, { name: 'handoffToTutor', description: 'Propone una estrategia pedagógica y delega su ejecución al Tutor.', schema: toolSchemas.handoffToTutor }),
    tool(({ reason }, config: ToolRuntime) => transfer(runtime, 'diagnostic_agent', reason, { diagnosis: undefined }, config),
      { name: 'requestRediagnosis', description: 'Solicita reevaluación solo por evidencia ausente o ambigua; especifica el dato necesario.', schema: toolSchemas.requestRediagnosis }),
  ];
}
export function tutorTools(runtime: TurnRuntime) {
  return [
    tool(({ intervention }) => {
      const s = runtime.current;
      ensure(s.strategyDecision, 'MISSING_STRATEGY', 'Falta estrategia.');
      const generation = validateGeneration(s.sessionSnapshot, s.action, s.strategyDecision, intervention);
      return new Command({ graph: Command.PARENT, goto: END, update: { turn: { ...s, tutorGeneration: generation, finished: true } } });
    }, { name: 'submitIntervention', description: 'Entrega la única intervención pública del turno y termina la ejecución.', schema: toolSchemas.submitIntervention }),
    tool(({ reason }, config: ToolRuntime) => transfer(runtime, 'analyst_agent', reason, {}, config),
      { name: 'requestStrategyClarification', description: 'Solicita aclarar una estrategia insuficiente; describe concretamente qué falta.', schema: toolSchemas.requestStrategyClarification }),
  ];
}
