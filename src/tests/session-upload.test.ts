import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createMaterialUploads } from '../web/material.js';

const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'mock-server-key' };

test('carga el archivo una vez y consulta la indexación de su ruta exacta', async () => {
  const payload = Buffer.from('# Mi hipótesis\nUna idea para practicar.');
  let path = '';
  let polls = 0;
  const materials = createMaterialUploads(env, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get('apikey'), env.SUPABASE_SECRET_KEY);
    if (url.pathname.startsWith('/storage/v1/object/')) {
      assert.equal(path, '');
      path = url.pathname.slice('/storage/v1/object/material-academico/'.length);
      assert.match(path, /^sesiones\/[a-f0-9-]{36}\/mi-hipotesis\.md$/u);
      assert.equal(new Headers(init?.headers).get('content-type'), 'text/markdown');
      assert.deepEqual(Buffer.from(init?.body as Uint8Array), payload);
      return Response.json({ Key: `material-academico/${path}` });
    }
    assert.equal(url.pathname, '/rest/v1/rpc/thinkagora_material_indexado');
    assert.deepEqual(JSON.parse(init?.body as string), { p_object_path: path });
    polls += 1;
    return Response.json(polls >= 2);
  });

  const { uploadId, topic } = await materials.upload('Mi hipótesis.MD', payload);
  assert.equal(topic, 'Mi hipótesis');
  await assert.rejects(materials.status(randomUUID()), /La carga expiró/u);
  assert.equal((await materials.status(uploadId)).indexed, false);
  const status = await materials.status(uploadId);
  assert.equal(status.indexed, true);
  assert.equal(status.material.source, `material-academico/${path}`);
});

test('rechaza PDF inválido y Markdown vacío antes de llamar a Storage', async () => {
  const materials = createMaterialUploads(env, async () => {
    assert.fail('El contenido inválido no debe llegar a Supabase');
  });
  await assert.rejects(materials.upload('material.pdf', Buffer.from('texto')), /encabezado PDF/u);
  await assert.rejects(materials.upload('material.md', Buffer.from('  ')), /debe contener texto/u);
});
