import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { diagnosticTools, type TurnRuntime } from '../graph/handoffs.js';
import { diagnosticPrompt, fundamentalsPrompts } from './prompts.js';
import { guardrails } from './guardrails.js';
export function createDiagnosticAgent(model: BaseChatModel, runtime: TurnRuntime) {
  return createAgent({ name: 'diagnostic_agent', model, systemPrompt: runtime.current.practice ? fundamentalsPrompts.diagnostic : diagnosticPrompt,
    tools: diagnosticTools(runtime), middleware: [guardrails(runtime)] });
}
