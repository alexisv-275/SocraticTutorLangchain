import type { BaseMessage } from '@langchain/core/messages';
import type { Diagnosis, StudentAction, StrategyDecision, StudySession, TutorGeneration } from '../domain/contracts.js';

export const roles = ['diagnostic_agent', 'analyst_agent', 'tutor_agent'] as const;
export type AgentRole = typeof roles[number];
export type GraphTurnState = {
  action: StudentAction | null;
  sessionSnapshot: StudySession;
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
