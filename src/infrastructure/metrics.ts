import { randomUUID } from 'node:crypto';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { AgentRole } from '../graph/state.js';
import { LIMITS } from '../config/limits.js';
import { ensure } from '../domain/errors.js';

export type Attempt = {
  callId: string; runId: string; roleOrAgent: AgentRole; model: string;
  startedAt: string; finishedAt: string | null; durationMs: number;
  inputTokens: number | null; outputTokens: number | null; status: 'running' | 'ok' | 'error';
};
export type Handoff = { fromAgent: AgentRole; toAgent: AgentRole; reason: string; time: string; accepted: boolean; rejectionCode?: string;
  strategyValidation?: { expected: string; received: string; difficulty: string; rule: string } };
export class MetricsCollector {
  readonly runId = randomUUID();
  readonly startedAt = new Date().toISOString();
  private start = performance.now();
  readonly attempts: Attempt[] = [];
  readonly handoffs: Handoff[] = [];
  readonly agentTrace: { role: AgentRole; time: string; activation: number }[] = [];
  technicalRetries = 0;
  modelInvocations = 0;
  constructor(readonly model: string, readonly mode: 'live' | 'mock') {}
  reserveCall() {
    ensure(this.modelInvocations < LIMITS.modelCalls, 'MODEL_BUDGET', 'Se agotó el presupuesto de llamadas.');
    this.modelInvocations++;
  }
  retry() {
    ensure(this.modelInvocations < LIMITS.modelCalls, 'MODEL_BUDGET', 'No queda presupuesto para reintentar.');
    ensure(this.technicalRetries < LIMITS.technicalRetries, 'RETRY_BUDGET', 'Se agotó el reintento técnico.');
    this.technicalRetries++;
  }
  callbacks(role: AgentRole) {
    const collector = this;
    return new class extends BaseCallbackHandler {
      name = 'turn-metrics';
      awaitHandlers = true;
      override handleChatModelStart(_llm: unknown, _messages: unknown, runId: string) {
        if (collector.attempts.some(a => a.callId === runId)) return;
        collector.attempts.push({ callId: runId, runId: collector.runId, roleOrAgent: role, model: collector.model,
          startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0, inputTokens: null, outputTokens: null, status: 'running' });
      }
      override handleLLMEnd(output: LLMResult, runId: string) { collector.finishAttempt(runId, 'ok', output); }
      override handleLLMError(_error: Error, runId: string) { collector.finishAttempt(runId, 'error'); }
    }();
  }
  finishAttempt(callId: string, status: 'ok' | 'error', output?: LLMResult) {
    const attempt = this.attempts.find(a => a.callId === callId);
    if (!attempt || attempt.status !== 'running') return;
    attempt.finishedAt = new Date().toISOString();
    attempt.durationMs = Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt);
    attempt.status = status;
    const generation = output?.generations[0]?.[0];
    const message = generation && 'message' in generation ? generation.message : undefined;
    const usage = message && typeof message === 'object' && 'usage_metadata' in message
      ? message.usage_metadata as { input_tokens?: number; output_tokens?: number } : undefined;
    // Una sola fuente por intento; no volver a sumar el uso al salir de agent.invoke().
    attempt.inputTokens = usage?.input_tokens ?? null;
    attempt.outputTokens = usage?.output_tokens ?? null;
  }
  finish() {
    // Un timeout puede devolver control antes del callback final del transporte.
    for (const attempt of this.attempts) if (attempt.status === 'running') this.finishAttempt(attempt.callId, 'error');
    const known = (key: 'inputTokens' | 'outputTokens') => this.attempts.reduce((n, a) => n + (a[key] ?? 0), 0);
    return { runId: this.runId, architecture: 'langchain' as const, mode: this.mode, model: this.model,
      startedAt: this.startedAt, finishedAt: new Date().toISOString(), latencyMs: performance.now() - this.start,
      llmCalls: this.mode === 'live' ? this.attempts.length : 0,
      simulatedModelCalls: this.mode === 'mock' ? this.attempts.length : 0,
      inputTokens: this.mode === 'live' ? known('inputTokens') : 0,
      outputTokens: this.mode === 'live' ? known('outputTokens') : 0,
      totalTokens: this.mode === 'live' ? known('inputTokens') + known('outputTokens') : 0,
      usageIncomplete: this.mode === 'live' && this.attempts.some(a => a.inputTokens === null || a.outputTokens === null),
      technicalRetries: this.technicalRetries, llmAttempts: structuredClone(this.attempts),
      handoffs: structuredClone(this.handoffs), agentTrace: structuredClone(this.agentTrace) };
  }
}
