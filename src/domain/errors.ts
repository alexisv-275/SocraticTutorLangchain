export class TurnError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'TurnError'; }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new TurnError(code, message);
}
