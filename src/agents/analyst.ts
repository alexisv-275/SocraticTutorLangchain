import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { analystTools, type TurnRuntime } from '../graph/handoffs.js';
import { analystPrompt } from './prompts.js';
import { guardrails } from './guardrails.js';
export function createAnalystAgent(model: BaseChatModel, runtime: TurnRuntime) {
  return createAgent({ name: 'analyst_agent', model, systemPrompt: analystPrompt,
    tools: analystTools(runtime), middleware: [guardrails(runtime)] });
}
