import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { randomUUID } from 'node:crypto';
import { topics } from '../academic/corpus.js';
import type { StrategyDecision, TutorGeneration, StudySession, StudentAction } from '../domain/contracts.js';
import { checkAnswer, hasTransferEvidence, requiredStrategy } from '../domain/policy.js';

export type MockStep = { name: string; args: Record<string, unknown> } | Error | ((messages: BaseMessage[]) => AIMessage);
export function toolMessage(name: string, args: Record<string, unknown>) {
  return new AIMessage({ content: '', tool_calls: [{ name, args, id: randomUUID(), type: 'tool_call' }] });
}
// Doble de transporte: conserva createAgent, las herramientas y Command.PARENT reales.
export class ScriptedModel extends BaseChatModel {
  index = 0;
  constructor(private readonly steps: MockStep[]) { super({ maxRetries: 0 }); }
  _llmType() { return 'scripted-offline'; }
  override bindTools() { return this; }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const step = this.steps[this.index++];
    if (!step) throw new Error('No quedan respuestas simuladas.');
    if (step instanceof Error) throw step;
    const message = typeof step === 'function' ? step(messages) : toolMessage(step.name, step.args);
    return { generations: [{ text: '', message }] };
  }
}
export function mockGeneration(strategy: StrategyDecision['strategy']): TutorGeneration {
  if (strategy === 'START_TOPIC') return { kind: 'TOPICS', message: 'Elige un tema para comenzar.', question: null, topics };
  if (strategy === 'HINT') return { kind: 'HINT', message: 'Piensa en la responsabilidad vinculada al valor, no en quién facilita el proceso. Inténtalo otra vez.', question: null, topics: null };
  const changing = strategy === 'CHANGE_TOPIC';
  const simple = strategy === 'SIMPLIFY';
  return { kind: 'QUESTION', message: simple ? 'El Product Owner cuida el valor del producto y la ordenación del trabajo. Probemos una situación más sencilla.'
    : changing ? 'Exploremos los eventos de Scrum.' : 'Veamos cómo aplicar esta idea en otra situación.', topics: null,
  question: { text: changing ? 'Durante el Sprint, Developers necesitan inspeccionar el avance y adaptar su plan. ¿Qué evento les sirve?'
    : simple ? '¿Qué responsabilidad corresponde al Product Owner?' : 'Un equipo crea una aplicación educativa. ¿Quién responde por ordenar mejoras según su valor?',
    options: changing ? { A: 'Sprint Planning.', B: 'Daily Scrum.', C: 'Ningún evento.' }
      : simple ? { A: 'Maximizar el valor del producto.', B: 'Crear por sí solo cada incremento.', C: 'Sustituir a Developers.' }
        : { A: 'Scrum Master.', B: 'Developers.', C: 'Product Owner.' },
    correctOptionId: changing ? 'B' : simple ? 'A' : 'C', privateRationale: 'La respuesta corresponde a la responsabilidad descrita en el corpus.',
    questionType: changing ? 'INITIAL' : simple ? 'SIMPLIFIED' : 'TRANSFER', difficulty: simple || changing ? 'LOW' : 'MEDIUM',
    conceptId: changing ? 'daily-scrum' : 'product-owner' } };
}
export function decision(strategy: StrategyDecision['strategy']): StrategyDecision {
  return { strategy, difficulty: strategy === 'SIMPLIFY' || strategy === 'CHANGE_TOPIC' ? 'LOW' : 'MEDIUM', justification: 'Intervención coherente con la evidencia y las reglas.', nextRole: 'tutor_agent' };
}

export function scenarioModel(session: StudySession, action: StudentAction | null) {
  const strategy = requiredStrategy(session, action);
  const steps: MockStep[] = [];
  if (action?.action === 'ANSWER') {
    steps.push({ name: 'checkAnswer', args: {} }, { name: 'handoffToAnalyst', args: {
      diagnosis: { result: checkAnswer(session, action), evidence: hasTransferEvidence(session, action) ? 'CONSISTENT' : 'PARTIAL',
        difficultyDetected: null, requiresVerification: !hasTransferEvidence(session, action) }, reason: 'Evaluación objetiva con evidencia del historial.' } });
  }
  if (action) steps.push({ name: 'handoffToTutor', args: { strategyDecision: decision(strategy), reason: 'Aplicar intervención adecuada a la evidencia.' } });
  steps.push({ name: 'submitIntervention', args: { intervention: mockGeneration(strategy) } });
  return new ScriptedModel(steps);
}
