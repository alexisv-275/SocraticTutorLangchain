import { createMiddleware } from 'langchain';
import { HumanMessage } from '@langchain/core/messages';
import { ensure, TurnError } from '../domain/errors.js';
import { toolSchemas, type TurnRuntime } from '../graph/handoffs.js';
import type { AgentRole } from '../graph/state.js';
import { requiredStrategy } from '../domain/policy.js';

function transient(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 429 || (status !== undefined && status >= 500)
    || ['APIConnectionError', 'APIConnectionTimeoutError'].includes((error as Error)?.name);
}
export function guardrails(runtime: TurnRuntime) {
  return createMiddleware({
    name: 'bounded-turn',
    wrapModelCall: async (request, handler) => {
      let next = request;
      while (true) {
        runtime.metrics.reserveCall();
        try {
          const response = await handler(next);
          const calls = response.tool_calls ?? [];
          ensure(calls.length === 1, 'INVALID_MODEL_OUTPUT', 'Usa exactamente una herramienta; no texto libre.');
          const call = calls[0]!;
          const schema = toolSchemas[call.name as keyof typeof toolSchemas];
          ensure(schema && request.tools.some(t => 'name' in t && t.name === call.name) && schema.safeParse(call.args).success,
            'INVALID_MODEL_OUTPUT', 'Herramienta o argumentos no válidos.');
          return response;
        } catch (error) {
          if (!(error instanceof TurnError && error.code === 'INVALID_MODEL_OUTPUT') && !transient(error)) throw error;
          runtime.metrics.retry();
          // Reintento explícito y global: nunca se reinicia al transferir de agente.
          next = { ...request, messages: [...request.messages, new HumanMessage('El intento falló. Usa una sola herramienta disponible con argumentos que cumplan exactamente su esquema.')] };
        }
      }
    },
    // No transformar rechazos de política en mensajes de herramienta que provoquen bucles.
    wrapToolCall: async (request, handler) => {
      const before = runtime.metrics.handoffs.length;
      try { return await handler(request); }
      catch (error) {
        const targets: Record<string, AgentRole> = { handoffToAnalyst: 'analyst_agent', handoffToTutor: 'tutor_agent',
          requestRediagnosis: 'diagnostic_agent', requestStrategyClarification: 'analyst_agent' };
        const target = targets[request.toolCall.name];
        if (target && runtime.metrics.handoffs.length === before) runtime.metrics.handoffs.push({
          fromAgent: runtime.current.activeAgent, toAgent: target,
          reason: String(request.toolCall.args.reason ?? '').slice(0, 400), time: new Date().toISOString(), accepted: false,
          rejectionCode: error instanceof TurnError ? error.code : 'INVALID_HANDOFF',
          ...(error instanceof TurnError && error.code === 'INVALID_STRATEGY' ? {
            strategyValidation: {
              expected: requiredStrategy(runtime.current.sessionSnapshot, runtime.current.action),
              received: String(request.toolCall.args.strategyDecision?.strategy),
              difficulty: String(request.toolCall.args.strategyDecision?.difficulty),
              rule: error.message,
            },
          } : {}),
        });
        throw error;
      }
    },
  });
}
