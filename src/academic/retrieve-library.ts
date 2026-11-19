import { z } from 'zod';
import { ensure, TurnError } from '../domain/errors.js';
import type { SourceChunk } from './fundamentals.js';
import { createSupabaseLibrary } from './supabase-library.js';

const vector = z.object({ data: z.tuple([z.object({
  index: z.literal(0),
  embedding: z.array(z.number()).length(1024),
})]) });
const excerpts = z.array(z.object({
  source: z.string().min(1), heading: z.string().min(1),
  chunk_position: z.number().int().nonnegative(), content: z.string().trim().min(1),
})).max(5);

export type RetrieveLibrary = (query: string, source?: string) => Promise<SourceChunk[]>;

export function createLibraryRetriever(env: NodeJS.ProcessEnv, request: typeof fetch = fetch): RetrieveLibrary {
  const apiKey = env.VOYAGEAI_API_KEY?.trim();
  ensure(apiKey, 'CONFIGURATION', 'Configura VOYAGEAI_API_KEY en .env.');
  const supabase = createSupabaseLibrary(env, request);
  return async (query, source) => {
    let response: Response;
    try {
      response = await request('https://api.voyageai.com/v1/embeddings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'voyage-4', input: [query], input_type: 'query', output_dimension: 1024, output_dtype: 'float',
        }),
        redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new TurnError('RAG_UNAVAILABLE', 'No se pudo conectar con Voyage AI.');
    }
    ensure(response.ok, 'RAG_UNAVAILABLE', 'Voyage AI no pudo generar la consulta.');
    const match = vector.safeParse(await response.json().catch(() => null));
    ensure(match.success, 'RAG_UNAVAILABLE', 'Voyage AI devolvió un vector inválido.');
    const endpoint = source ? 'thinkagora_buscar_material' : 'thinkagora_buscar_biblioteca';
    const rows = excerpts.safeParse(await supabase(`/rest/v1/rpc/${endpoint}`, JSON.stringify({
      p_embedding: JSON.stringify(match.data.data[0].embedding),
      ...(source ? { p_source: source } : {}),
    })));
    ensure(rows.success, 'RAG_UNAVAILABLE', 'La biblioteca devolvió un formato inesperado.');
    ensure(!source || rows.data.every(row => row.source === source), 'RAG_UNAVAILABLE', 'La búsqueda devolvió material ajeno a la sesión.');
    return rows.data;
  };
}
