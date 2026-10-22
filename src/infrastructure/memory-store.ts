import { StudySessionSchema, type StudySession } from '../domain/contracts.js';
import { ensure } from '../domain/errors.js';

export class MemorySessionStore {
  private sessions = new Map<string, { version: number; session: StudySession }>();
  get(sessionId: string) {
    const entry = this.sessions.get(sessionId);
    return entry ? structuredClone(entry) : undefined;
  }
  // Compare-and-swap evita que dos turnos confirmen sobre el mismo snapshot.
  save(session: StudySession, expectedVersion: number) {
    const current = this.sessions.get(session.sessionId);
    ensure((current?.version ?? 0) === expectedVersion, 'STALE_SESSION', 'La sesión cambió; vuelve a intentar.');
    this.sessions.set(session.sessionId, { version: expectedVersion + 1, session: structuredClone(StudySessionSchema.parse(session)) });
  }
  reset(session: StudySession) { this.sessions.set(session.sessionId, { version: 1, session: structuredClone(StudySessionSchema.parse(session)) }); }
}
