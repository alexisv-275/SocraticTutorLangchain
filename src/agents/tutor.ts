import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { tutorTools, type TurnRuntime } from '../graph/handoffs.js';
import { tutorPrompt } from './prompts.js';
import { guardrails } from './guardrails.js';
export function createTutorAgent(model: BaseChatModel, runtime: TurnRuntime) {
  return createAgent({ name: 'tutor_agent', model, systemPrompt: tutorPrompt,
    tools: tutorTools(runtime), middleware: [guardrails(runtime)] });
}
