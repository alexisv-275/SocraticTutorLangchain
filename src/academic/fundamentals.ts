export const fundamentalsConcept = 'fundamentos';
export const questionFocus = [
  'Reconoce la situación',
  'Explica la idea inicial',
  'Detecta supuestos básicos',
  'Reconoce la situación',
  'Explica la idea inicial',
  'Detecta supuestos básicos',
] as const;

export type SourceChunk = { source: string; heading: string; chunk_position: number; content: string };
export type GroundedQuestion = {
  topic: string; focus: typeof questionFocus[number]; excerpts: SourceChunk[];
};
export type PracticeContext = {
  current: GroundedQuestion | null;
  next: GroundedQuestion | null;
};
