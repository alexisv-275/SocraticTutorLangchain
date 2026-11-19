import { ensure, TurnError } from '../domain/errors.js';

export const libraryBucket = 'material-academico';

export function createSupabaseLibrary(env: NodeJS.ProcessEnv, request: typeof fetch = fetch) {
  const key = env.SUPABASE_SECRET_KEY?.trim();
  const url = env.SUPABASE_URL?.trim().replace(/\/$/u, '');
  ensure(key && url && /^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url),
    'CONFIGURATION', 'Configura SUPABASE_URL y SUPABASE_SECRET_KEY en .env.');

  return async (path: string, body: BodyInit, contentType = 'application/json') => {
    try {
      const response = await request(`${url}${path}`, {
        method: 'POST', headers: { 'Content-Type': contentType, apikey: key },
        body, redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.json() as unknown;
    } catch { /* Solo se expone el error público de la biblioteca. */ }
    throw new TurnError('RAG_UNAVAILABLE', 'Supabase no pudo completar la operación de la biblioteca.');
  };
}
