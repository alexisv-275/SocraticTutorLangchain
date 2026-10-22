import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { diagnosticTools, type TurnRuntime } from '../graph/handoffs.js';
import { diagnosticPrompt } from './prompts.js';
import { guardrails } from './guardrails.js';
export function createDiagnosticAgent(model: BaseChatModel, runtime: TurnRuntime) {
  return createAgent({ name: 'diagnostic_agent', model, systemPrompt: diagnosticPrompt,
    tools: diagnosticTools(runtime), middleware: [guardrails(runtime)] });
}
