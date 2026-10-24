import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../server.mjs';
import { Store } from '../src/store.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const sample = await readFile(new URL('./fixtures/sample.txt', import.meta.url));

async function start(maxBytes = 25 * 1024 * 1024) {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-api-'));
  const store = new Store(dir);
  const server = createServer({ store, publicDir, maxBytes });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    dir,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function upload(base, { buffer, filename, type = 'application/octet-stream' }) {
  return fetch(`${base}/api/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': type,
      'X-Filename': encodeURIComponent(filename),
    },
    body: buffer,
  });
}

test('upload, list, read, annotate and delete', async () => {
  const app = await start();
  try {
    const res = await upload(app.base, { buffer: sample, filename: 'sample.txt' });
    assert.equal(res.status, 201);
    const { document } = await res.json();
    assert.match(document.id, /^doc_[a-f0-9]{12}$/);
    assert.equal(document.filename, 'sample.txt');
    assert.equal(document.text, 'First paragraph.\n\nSecond paragraph with more text.');
    assert.equal(document.paragraphs.length, 2);

    const list = await (await fetch(`${app.base}/api/documents`)).json();
    assert.equal(list.documents.length, 1);

    const got = await (await fetch(`${app.base}/api/documents/${document.id}`)).json();
    assert.equal(got.document.id, document.id);

    const put = await fetch(`${app.base}/api/documents/${document.id}/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations: [{ start: 0, end: 5, label: 'Person' }] }),
    });
    assert.equal(put.status, 200);
    const saved = await put.json();
    assert.equal(saved.annotations.length, 1);
    assert.equal(saved.annotations[0].text, 'First');
    assert.match(saved.annotations[0].id, /^ann_[a-f0-9]{12}$/);

    const read = await (await fetch(`${app.base}/api/documents/${document.id}/annotations`)).json();
    assert.deepEqual(read.annotations, saved.annotations);

    const del = await fetch(`${app.base}/api/documents/${document.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    const missing = await fetch(`${app.base}/api/documents/${document.id}`);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test('invalid annotations are rejected with 422', async () => {
  const app = await start();
  try {
    const { document } = await (await upload(app.base, { buffer: sample, filename: 'sample.txt' })).json();
    const endpoint = `${app.base}/api/documents/${document.id}/annotations`;
    const put = (annotations) => fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations }),
    });

    assert.equal((await put([{ start: 0, end: 5, label: 'Animal' }])).status, 422);
    assert.equal((await put([{ start: 0, end: 999, label: 'Person' }])).status, 422);
    assert.equal((await put([
      { start: 0, end: 5, label: 'Person' },
      { start: 3, end: 8, label: 'Person' },
    ])).status, 422);
    assert.equal((await put([
      { start: 0, end: 5, label: 'Person', text: 'Wrong' },
    ])).status, 422);
  } finally {
    await app.close();
  }
});

test('unsupported, empty and oversized uploads fail clearly', async () => {
  const app = await start(8);
  try {
    const unsupported = await upload(app.base, {
      buffer: Buffer.from('old doc'),
      filename: 'legacy.doc',
    });
    assert.equal(unsupported.status, 415);
    assert.equal((await unsupported.json()).error.code, 'UNSUPPORTED_FORMAT');

    const empty = await upload(app.base, {
      buffer: await readFile(new URL('./fixtures/empty.txt', import.meta.url)),
      filename: 'empty.txt',
    });
    assert.equal(empty.status, 422);
    assert.equal((await empty.json()).error.code, 'NO_TEXT');

    const oversized = await upload(app.base, {
      buffer: Buffer.from('this body is longer than eight bytes'),
      filename: 'big.txt',
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, 'FILE_TOO_LARGE');
  } finally {
    await app.close();
  }
});

test('static page and assets are served', async () => {
  const app = await start();
  try {
    const home = await fetch(`${app.base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Text Annotator/);

    const script = await fetch(`${app.base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);

    const style = await fetch(`${app.base}/style.css`);
    assert.equal(style.status, 200);
    assert.match(style.headers.get('content-type') ?? '', /css/);
  } finally {
    await app.close();
  }
});

test('missing document and malformed JSON are handled', async () => {
  const app = await start();
  try {
    assert.equal((await fetch(`${app.base}/api/documents/doc_ffffffffffff`)).status, 404);

    const missingPut = await fetch(`${app.base}/api/documents/doc_ffffffffffff/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(missingPut.status, 404);

    const { document } = await (await upload(app.base, { buffer: sample, filename: 'sample.txt' })).json();
    const res = await fetch(`${app.base}/api/documents/${document.id}/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
