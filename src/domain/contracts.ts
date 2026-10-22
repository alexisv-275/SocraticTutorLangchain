import { z } from 'zod';

export const OptionId = z.enum(['A', 'B', 'C']);
export const Difficulty = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const QuestionType = z.enum(['INITIAL', 'REFORMULATION', 'TRANSFER', 'SIMPLIFIED']);
export const HelpLevel = z.enum(['NONE', 'HINT', 'EXPLANATION']);
export const Comprehension = z.enum(['UNASSESSED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED']);
const shortText = z.string().trim().min(1).max(1200);
export const StudentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ANSWER'), questionId: shortText, selectedOptionId: OptionId }).strict(),
  z.object({ action: z.literal('REQUEST_HINT'), questionId: shortText }).strict(),
  z.object({ action: z.literal('CHANGE_TOPIC'), targetTopicId: shortText }).strict(),
]);
export type StudentAction = z.infer<typeof StudentActionSchema>;
export const OptionsSchema = z.object({ A: shortText, B: shortText, C: shortText }).strict()
  .refine(o => new Set(Object.values(o).map(v => v.toLowerCase())).size === 3, 'Las opciones deben ser distintas');
export const GeneratedQuestionSchema = z.object({
  text: shortText, options: OptionsSchema, correctOptionId: OptionId,
  privateRationale: shortText, questionType: QuestionType, difficulty: Difficulty,
  conceptId: shortText,
}).strict();
export const QuestionSchema = GeneratedQuestionSchema.extend({ id: shortText });
export type Question = z.infer<typeof QuestionSchema>;
export const DiagnosisSchema = z.object({
  result: z.enum(['CORRECT', 'INCORRECT', 'UNCERTAIN', 'NOT_APPLICABLE']),
  evidence: z.enum(['INSUFFICIENT', 'PARTIAL', 'CONSISTENT']),
  difficultyDetected: shortText.nullable(), requiresVerification: z.boolean(),
}).strict();
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export const StrategySchema = z.enum(['START_TOPIC', 'DEEPEN', 'HINT', 'SIMPLIFY', 'VERIFY', 'CHANGE_TOPIC', 'CHECKPOINT']);
export const StrategyDecisionSchema = z.object({
  strategy: StrategySchema, difficulty: Difficulty, justification: shortText,
  nextRole: z.literal('tutor_agent').optional(),
}).strict();
export type StrategyDecision = z.infer<typeof StrategyDecisionSchema>;
export const TopicSchema = z.object({ id: shortText, title: shortText }).strict();
export const TutorGenerationSchema = z.object({
  kind: z.enum(['TOPICS', 'QUESTION', 'HINT']), message: shortText,
  question: GeneratedQuestionSchema.nullable(), topics: z.array(TopicSchema).max(3).nullable(),
}).strict();
export type TutorGeneration = z.infer<typeof TutorGenerationSchema>;
export const HistoryEntrySchema = z.object({
  topicId: z.string().nullable(), conceptId: z.string().nullable(),
  questionId: z.string().nullable(), questionType: QuestionType.nullable(),
  selectedOptionId: OptionId.nullable(), result: DiagnosisSchema.shape.result,
  strategy: StrategySchema, helpLevel: HelpLevel,
});
export const StudySessionSchema = z.object({
  sessionId: shortText, topicId: z.string().nullable(), conceptId: z.string().nullable(),
  currentQuestion: QuestionSchema.nullable(), consecutiveErrors: z.number().int().nonnegative(),
  helpLevel: HelpLevel, comprehension: Comprehension, history: z.array(HistoryEntrySchema),
  resolvedSituations: z.number().int().nonnegative().optional(),
}).strict().superRefine((s, ctx) => {
  if (s.currentQuestion && (!s.topicId || s.conceptId !== s.currentQuestion.conceptId)) {
    ctx.addIssue({ code: 'custom', message: 'Pregunta y concepto activo deben corresponder' });
  }
  if (!s.topicId && (s.conceptId || s.currentQuestion)) {
    ctx.addIssue({ code: 'custom', message: 'No puede haber concepto sin tema' });
  }
});
export type StudySession = z.infer<typeof StudySessionSchema>;

export const PublicQuestionSchema = QuestionSchema.omit({ correctOptionId: true, privateRationale: true });
export const PublicTurnResponseSchema = z.object({
  message: z.string(), question: PublicQuestionSchema.nullable(), topics: z.array(TopicSchema),
  actions: z.array(z.object({ id: z.enum(['4', '5']), label: z.string() }).strict()),
}).strict();
export type PublicTurnResponse = z.infer<typeof PublicTurnResponseSchema>;

// Lista blanca: nunca serializar la sesión ni la salida cruda del agente al estudiante.
export function publicResponse(message: string, question: Question | null, topics: z.infer<typeof TopicSchema>[] = []): PublicTurnResponse {
  const visible = question ? PublicQuestionSchema.parse({
    id: question.id, text: question.text, options: question.options,
    questionType: question.questionType, difficulty: question.difficulty, conceptId: question.conceptId,
  }) : null;
  return PublicTurnResponseSchema.parse({ message, question: visible, topics,
    actions: question ? [{ id: '4', label: 'Necesito una pista' }, { id: '5', label: 'Cambiar de tema' }] : [],
  });
}
