import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSupabaseLibrary, libraryBucket } from '../academic/supabase-library.js';
import { ensure, TurnError } from '../domain/errors.js';

export const maxMaterialBytes = 10 * 1024 * 1024;
export const MaterialId = z.object({ uploadId: z.uuid() }).strict();
type Material = { name: string; topic: string; source: string; path: string; expires: number };
const ttl = 60 * 60 * 1000;

function checkMaterial(name: string, bytes: Uint8Array) {
  const extension = /\.(pdf|md)$/iu.exec(name)?.[1]?.toLowerCase();
  ensure(extension && name.length <= 200 && !/[/\\\u0000-\u001f\u007f]/u.test(name),
    'INVALID_ACTION', 'Selecciona un PDF o Markdown con un nombre de archivo válido.');
  ensure(bytes.length > 0 && bytes.length <= maxMaterialBytes, 'INVALID_ACTION', 'El archivo debe pesar entre 1 byte y 10 MiB.');

  if (extension === 'pdf') {
    ensure(Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-',
      'INVALID_ACTION', 'El archivo seleccionado no tiene un encabezado PDF válido.');
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new TurnError('INVALID_ACTION', 'El Markdown debe estar codificado en UTF-8.');
    }
    ensure(text.trim() && !text.includes('\0'), 'INVALID_ACTION', 'El Markdown debe contener texto válido.');
  }
  const topic = name.slice(0, -(extension.length + 1)).replace(/[-_]+/gu, ' ').trim().slice(0, 160) || 'Material de estudio';
  const filename = topic.normalize('NFKD').replace(/\p{Mark}/gu, '')
    .replace(/[^A-Za-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '')
    .slice(0, 100).toLowerCase() || 'material';
  return { topic, filename: `${filename}.${extension}`, contentType: extension === 'pdf' ? 'application/pdf' : 'text/markdown' };
}

export function createMaterialUploads(env: NodeJS.ProcessEnv, request: typeof fetch = fetch) {
  const supabase = createSupabaseLibrary(env, request);
  const uploads = new Map<string, Material>();

  return {
    async upload(name: string, bytes: Uint8Array) {
      const { topic, filename, contentType } = checkMaterial(name, bytes);
      const now = Date.now();
      for (const [id, material] of uploads) if (material.expires <= now) uploads.delete(id);
      ensure(uploads.size < 100, 'BUSY', 'Hay demasiados materiales en proceso. Intenta más tarde.');
      const uploadId = randomUUID();
      const path = `sesiones/${uploadId}/${filename}`;
      const source = `${libraryBucket}/${path}`;
      uploads.set(uploadId, { name, topic, source, path, expires: now + ttl });
      try {
        const uploaded = z.object({ Key: z.literal(source) }).safeParse(await supabase(
          `/storage/v1/object/${source}`, new Uint8Array(bytes), contentType,
        ));
        ensure(uploaded.success, 'RAG_UNAVAILABLE', 'Supabase no confirmó el destino del archivo.');
        return { uploadId, name, topic };
      } catch (error) {
        uploads.delete(uploadId);
        throw error;
      }
    },

    async status(uploadId: string) {
      const material = uploads.get(uploadId);
      ensure(material && material.expires > Date.now(), 'SESSION_EXPIRED', 'La carga expiró. Selecciona el archivo de nuevo.');
      const status = z.boolean().safeParse(await supabase('/rest/v1/rpc/thinkagora_material_indexado',
        JSON.stringify({ p_object_path: material.path })));
      ensure(status.success, 'RAG_UNAVAILABLE', 'Supabase no devolvió el estado de la ingesta.');
      return { indexed: status.data, material };
    },
  };
}
