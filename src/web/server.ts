import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createLibraryRetriever } from '../academic/retrieve-library.js';
import { readConfig } from '../config/env.js';
import { createClaudeModel } from '../config/model.js';
import { TurnError, ensure } from '../domain/errors.js';
import { AnswerInput, StartInput, createPractice } from './practice.js';
import { createMaterialUploads, MaterialId, maxMaterialBytes } from './material.js';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3100);
const origin = `http://localhost:${port}`;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const knownErrors: Record<string, number> = {
  CONFIGURATION: 503, RAG_EMPTY: 503, RAG_UNAVAILABLE: 502,
  SESSION_EXPIRED: 410, BUSY: 409, MATERIAL_PENDING: 409, INVALID_ACTION: 400,
};
let practice: ReturnType<typeof createPractice> | undefined;
let materials: ReturnType<typeof createMaterialUploads> | undefined;

function getPractice() {
  if (!practice) {
    const config = readConfig();
    const retrieve = createLibraryRetriever(process.env);
    const model = createClaudeModel({ ...config, ANTHROPIC_EFFORT: config.ANTHROPIC_EFFORT ?? 'low' });
    practice = createPractice(model, retrieve, config.ANTHROPIC_MODEL, config.TURN_TIMEOUT_MS);
  }
  return practice;
}

function getMaterials() {
  return materials ??= createMaterialUploads(process.env);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBytes(request: IncomingMessage, limit: number) {
  const declared = Number(request.headers['content-length']);
  ensure(!Number.isFinite(declared) || declared <= limit, 'INVALID_ACTION', 'La solicitud supera el tamaño permitido.');
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const data of request) {
    const buffer = Buffer.from(data);
    size += buffer.length;
    ensure(size <= limit, 'INVALID_ACTION', 'La solicitud supera el tamaño permitido.');
    buffers.push(buffer);
  }
  return Buffer.concat(buffers);
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBytes(request, 4096);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TurnError('INVALID_ACTION', 'La solicitud no es JSON válido.');
  }
}

const server = createServer(async (request, response) => {
  try {
    const target = new URL(request.url ?? '/', origin);
    const path = target.pathname;
    const asset = assets.get(path);
    if (request.method === 'GET' && asset?.[0] && asset[1]) {
      const content = readFileSync(new URL(`./public/${asset[0]}`, import.meta.url));
      response.writeHead(200, {
        'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      });
      response.end(content);
      return;
    }
    if (request.method !== 'POST' || !['/api/start', '/api/answer', '/api/material', '/api/material/status'].includes(path)) {
      json(response, 404, { error: 'Ruta no disponible.' });
      return;
    }
    const requester = request.headers.origin;
    const expectedType = path === '/api/material' ? 'application/octet-stream' : 'application/json';
    if ((requester && requester !== origin && requester !== `http://127.0.0.1:${port}`)
      || request.headers['content-type']?.split(';')[0] !== expectedType) {
      json(response, 403, { error: 'La solicitud debe venir de la pantalla local de ThinkAgora.' });
      return;
    }
    if (path === '/api/material') {
      getPractice();
      const bytes = await readBytes(request, maxMaterialBytes);
      json(response, 202, await getMaterials().upload(target.searchParams.get('filename') ?? '', bytes));
      return;
    }
    const body = await requestBody(request);
    if (path === '/api/material/status') {
      getPractice();
      const input = MaterialId.safeParse(body);
      ensure(input.success, 'INVALID_ACTION', 'Identificador de carga inválido.');
      const { indexed } = await getMaterials().status(input.data.uploadId);
      json(response, 200, { indexed });
    } else if (path === '/api/start') {
      const input = StartInput.safeParse(body);
      ensure(input.success, 'INVALID_ACTION', 'Escribe un tema de hasta 160 caracteres o selecciona un archivo.');
      const tutor = getPractice();
      const uploaded = input.data.uploadId ? await getMaterials().status(input.data.uploadId) : undefined;
      ensure(!uploaded || uploaded.indexed, 'MATERIAL_PENDING', 'El archivo todavía se está indexando.');
      const topic = input.data.topic ?? uploaded?.material.topic;
      ensure(topic, 'INVALID_ACTION', 'Escribe un tema de estudio.');
      json(response, 201, await tutor.start(topic, uploaded?.material.source));
    } else {
      const input = AnswerInput.safeParse(body);
      ensure(input.success, 'INVALID_ACTION', 'Selecciona una opción válida.');
      json(response, 200, await getPractice().answer(input.data));
    }
  } catch (error) {
    const knownStatus = error instanceof TurnError ? knownErrors[error.code] : undefined;
    if (error instanceof TurnError && knownStatus) {
      json(response, knownStatus, { error: error.message, code: error.code });
      return;
    }
    const status = (error as { status?: number })?.status;
    if (status === 401 || status === 403) {
      json(response, 502, { error: 'Claude rechazó la solicitud. Revisa ANTHROPIC_API_KEY y el acceso al modelo.' });
      return;
    }
    console.error('Turno de Fundamentos fallido', error instanceof TurnError ? `${error.code} ${error.message}` : (error as Error)?.name);
    json(response, 502, { error: 'El tutor no pudo completar el turno. Puedes volver a intentarlo.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`ThinkAgora Fundamentos · ${origin}`));
