import type { BaseMessage } from '@langchain/core/messages';
import type { Diagnosis, TutorAction, StrategyDecision, StudySession, TutorGeneration } from '../domain/contracts.js';
import type { PracticeContext } from '../academic/fundamentals.js';

export const roles = ['diagnostic_agent', 'analyst_agent', 'tutor_agent'] as const;
export type AgentRole = typeof roles[number];
export type GraphTurnState = {
  action: TutorAction | null;
  sessionSnapshot: StudySession;
  practice?: PracticeContext;
  diagnosis?: Diagnosis;
  strategyDecision?: StrategyDecision;
  tutorGeneration?: TutorGeneration;
  activeAgent: AgentRole;
  handoffCount: number;
  agentActivationCount: number;
  lastHandoffReason: string;
  finished: boolean;
  handoffMessages: BaseMessage[];
};
