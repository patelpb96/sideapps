You are B1, the backend author for Text Annotator V1. You have no tools. Implement the backend exactly to the contract and the provided tests. Return a single bundle of complete files; do not omit any file. Do not write tests or frontend files. Use Node 20+ ESM and zero npm dependencies. No shell except `execFile` for `pdftotext`. The code must be complete and runnable.

Required files:
- apps/text-annotator/package.json
- apps/text-annotator/src/id.mjs
- apps/text-annotator/src/docx.mjs
- apps/text-annotator/src/pdf.mjs
- apps/text-annotator/src/extract.mjs
- apps/text-annotator/src/validate.mjs
- apps/text-annotator/src/store.mjs
- apps/text-annotator/server.mjs

Return format: for each file, a line `FILE: <path>` followed by a fenced code block with the full contents. No commentary outside the bundle.

CONTRACT:
# Text Annotator V1 — contract

This is the backend-first contract. The frontend is a consumer of it.

## Runtime

- Node 20+ (tested on Node 24), ESM, zero npm dependencies.
- App root: `apps/text-annotator`.
- Start: `node server.mjs`. `PORT` defaults to `4174`.
- Data lives under `data/` (gitignored):
  - `data/documents/<id>.json`
  - `data/annotations/<id>.json`

## Document shape

```json
{
  "id": "doc_0123456789ab",
  "filename": "example.txt",
  "ext": "txt",
  "text": "First paragraph.\n\nSecond paragraph.",
  "paragraphs": [
    { "index": 0, "text": "First paragraph.", "start": 0, "end": 16 },
    { "index": 1, "text": "Second paragraph.", "start": 18, "end": 34 }
  ],
  "warnings": [],
  "createdAt": "2026-10-23T12:00:00.000Z",
  "meta": { "chars": 34, "words": 4, "paragraphs": 2 }
}
```

`text` is exactly `paragraphs.map((p) => p.text).join("\n\n")`. Offsets are
UTF-16 code-unit offsets into `text` (JavaScript string indices).

## Upload

`POST /api/documents`

Headers:

- `Content-Type: application/octet-stream`
- `X-Filename: <encodeURIComponent(original name)>`

Body: raw file bytes, at most 25 MiB.

`201` response: `{ "document": <Document> }`.

Errors: `{ "error": { "code": "...", "message": "..." } }`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_FILENAME` | missing or invalid `X-Filename` |
| 413 | `FILE_TOO_LARGE` | over the limit |
| 415 | `UNSUPPORTED_FORMAT` | extension is not txt/md/docx/pdf |
| 422 | `NO_TEXT` | extraction produced no non-empty paragraphs |
| 422 | `PDF_TOOL_MISSING` | `pdftotext` is not installed |
| 422 | `EXTRACT_FAILED` | parser failed for another reason |
| 500 | `INTERNAL` | unexpected server error |

Extraction rules:

- **txt/md**: UTF-8, strip a leading BOM, normalize CRLF/CR to LF. Paragraphs
  are separated by one or more blank lines; line breaks inside a paragraph are
  preserved. Trim trailing whitespace per paragraph; drop empty paragraphs.
- **docx**: read the ZIP entry `word/document.xml`. Map `<w:p>` to a paragraph,
  `<w:t>` to text, `<w:tab/>` to `\t`, `<w:br/>` to `\n`. Decode XML entities.
  Cap the uncompressed XML at 20 MiB. No external converter.
- **pdf**: write the bytes to a temp file, run
  `pdftotext -layout -enc UTF-8 <temp> -` with `execFile`, a 20-second timeout,
  and a 10 MiB stdout cap. No shell. Normalize form feeds to paragraph breaks.
  Empty output is `NO_TEXT`; a missing binary is `PDF_TOOL_MISSING`.
- **.doc** and everything else: `UNSUPPORTED_FORMAT`.

## Documents

- `GET /api/documents` → `{ "documents": [{ id, filename, ext, chars, annotations, createdAt }] }`.
- `GET /api/documents/:id` → `{ "document": <Document> }` or 404.
- `DELETE /api/documents/:id` → 204; idempotent 404 for a missing document.

## Annotations

Shape:

```json
{
  "id": "ann_0123456789ab",
  "start": 0,
  "end": 5,
  "label": "Person",
  "text": "Alice",
  "createdAt": "2026-10-23T12:00:00.000Z"
}
```

Rules:

- `0 <= start < end <= document.text.length`.
- `text` is exactly `document.text.slice(start, end)`.
- `label` is one of `Person`, `Organization`, `Location`, `Date`, `Amount`,
  `Other`.
- Annotations do not overlap. They are stored sorted by `start`, then `end`.
- The server fills `id`, `text`, and `createdAt` if they are absent; if `text`
  is present it must match exactly.
- The client sends only `start`, `end`, and `label` in normal use.

Endpoints:

- `GET /api/documents/:id/annotations` → `{ "annotations": [...] }`.
- `PUT /api/documents/:id/annotations` with `{ "annotations": [...] }` →
  `{ "annotations": [...] }` (the stored, normalized list).
- Invalid shape, label, bounds, text mismatch, or overlap → 422
  `INVALID_ANNOTATIONS` with a message naming the first error.
- Missing document → 404 `NOT_FOUND`.

## Module interfaces

The tests import these directly.

```js
// src/extract.mjs
export class ExtractError extends Error { code; status; }
export async function extractDocument({ buffer, filename }) -> {
  ext, text, paragraphs: [{ index, text, start, end }], warnings
}

// src/docx.mjs
export function extractDocx(buffer) -> string[]   // paragraphs

// src/pdf.mjs
export async function extractPdf(buffer) -> string[] // paragraphs

// src/store.mjs
export class Store {
  constructor(dir)
  async saveDocument(doc)
  async getDocument(id)
  async listDocuments()
  async deleteDocument(id)
  async saveAnnotations(id, annotations)
  async getAnnotations(id)
}

// src/validate.mjs
export const LABELS
export function validateAnnotations(annotations, text) -> string[] // empty = valid

// src/id.mjs
export function newId(prefix) -> string

// server.mjs
export function createServer({ store, publicDir, maxBytes }) -> http.Server
```

## Frontend

- One page, no build step, no external assets.
- Upload or drag a file; list documents; open one; select text; choose a label;
  save; highlight; list and delete annotations; export JSON.
- Square corners. Light and dark via `prefers-color-scheme`.
- A clear error panel for unsupported formats, no text, and too-large files.
- No overlapping annotations in V1; the UI explains the rejection.

## Tests

`node --test` from `apps/text-annotator` covers:

- TXT, MD, DOCX and PDF extraction; BOM/CRLF normalization; `NO_TEXT`;
  unsupported extension.
- Store save/get/list/delete.
- Annotation validation: bounds, label, text mismatch, overlap.
- API: upload, list, get, put/get annotations, 413, 415, 422, 404.
- Static page and assets are served.

The tests may create their own fixtures and temp directories.


ACCEPTANCE TESTS:

--- apps/text-annotator/test/extract.test.mjs ---
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { extractDocument, ExtractError } from '../src/extract.mjs';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const hasPdfTool = () => {
  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  return probe.status === 0 || probe.status === 1;
};

test('txt extracts paragraphs and exact offsets', async () => {
  const buffer = await readFile(fixture('sample.txt'));
  const doc = await extractDocument({ buffer, filename: 'sample.txt' });

  assert.equal(doc.ext, 'txt');
  assert.equal(doc.text, 'First paragraph.\n\nSecond paragraph with more text.');
  assert.deepEqual(
    doc.paragraphs.map((p) => p.text),
    ['First paragraph.', 'Second paragraph with more text.'],
  );

  for (const p of doc.paragraphs) {
    assert.equal(doc.text.slice(p.start, p.end), p.text);
  }
  assert.deepEqual(doc.warnings, []);
});

test('markdown is treated as plain text', async () => {
  const buffer = await readFile(fixture('sample.md'));
  const doc = await extractDocument({ buffer, filename: 'sample.md' });

  assert.equal(doc.ext, 'md');
  assert.match(doc.text, /^# Heading\n\nSome \*\*bold\*\* text/);
  assert.equal(doc.paragraphs.length, 3);
  for (const p of doc.paragraphs) {
    assert.equal(doc.text.slice(p.start, p.end), p.text);
  }
});

test('txt strips a BOM and normalizes CRLF', async () => {
  const buffer = Buffer.from('\uFEFFLine one\r\n\r\nLine two\r\n', 'utf8');
  const doc = await extractDocument({ buffer, filename: 'crlf.txt' });

  assert.equal(doc.text, 'Line one\n\nLine two');
});

test('docx extracts paragraphs from word/document.xml', async () => {
  const buffer = await readFile(fixture('sample.docx'));
  const doc = await extractDocument({ buffer, filename: 'sample.docx' });

  assert.equal(doc.ext, 'docx');
  assert.equal(doc.text, 'Hello DOCX.\n\nSecond paragraph.');
  assert.equal(doc.paragraphs.length, 2);
});

test('pdf extracts an existing text layer', { skip: !hasPdfTool() && 'pdftotext not installed' }, async () => {
  const buffer = await readFile(fixture('sample.pdf'));
  const doc = await extractDocument({ buffer, filename: 'sample.pdf' });

  assert.equal(doc.ext, 'pdf');
  assert.equal(doc.text, 'Hello PDF');
});

test('empty text returns NO_TEXT', async () => {
  const buffer = await readFile(fixture('empty.txt'));
  await assert.rejects(
    () => extractDocument({ buffer, filename: 'empty.txt' }),
    (error) => error instanceof ExtractError && error.code === 'NO_TEXT',
  );
});

test('textless docx returns NO_TEXT', async () => {
  const buffer = await readFile(fixture('no-text.docx'));
  await assert.rejects(
    () => extractDocument({ buffer, filename: 'no-text.docx' }),
    (error) => error instanceof ExtractError && error.code === 'NO_TEXT',
  );
});

test('blank pdf returns NO_TEXT', { skip: !hasPdfTool() && 'pdftotext not installed' }, async () => {
  const buffer = await readFile(fixture('blank.pdf'));
  await assert.rejects(
    () => extractDocument({ buffer, filename: 'blank.pdf' }),
    (error) => error instanceof ExtractError && error.code === 'NO_TEXT',
  );
});

test('unsupported format returns UNSUPPORTED_FORMAT', async () => {
  await assert.rejects(
    () => extractDocument({ buffer: Buffer.from('old'), filename: 'legacy.doc' }),
    (error) => error instanceof ExtractError && error.code === 'UNSUPPORTED_FORMAT',
  );
});

test('a corrupt docx returns EXTRACT_FAILED', async () => {
  await assert.rejects(
    () => extractDocument({ buffer: Buffer.from('not a zip'), filename: 'broken.docx' }),
    (error) => error instanceof ExtractError && error.code === 'EXTRACT_FAILED',
  );
});

--- apps/text-annotator/test/validate.test.mjs ---
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LABELS, validateAnnotations } from '../src/validate.mjs';

const text = 'Alice met Bob in Paris on 12 May 2026.';

const ann = (start, end, label = 'Person') => ({
  start,
  end,
  label,
  text: text.slice(start, end),
});

test('LABELS is the V1 label set', () => {
  assert.deepEqual(LABELS, ['Person', 'Organization', 'Location', 'Date', 'Amount', 'Other']);
});

test('valid annotations produce no errors', () => {
  assert.deepEqual(validateAnnotations([ann(0, 5), ann(10, 13), ann(21, 26, 'Location')], text), []);
});

test('unknown label is rejected', () => {
  const errors = validateAnnotations([ann(0, 5, 'Animal')], text);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /label/i);
});

test('out-of-bounds and inverted spans are rejected', () => {
  assert.equal(validateAnnotations([ann(0, text.length + 1)], text).length, 1);
  assert.equal(validateAnnotations([ann(5, 5)], text).length, 1);
  assert.equal(validateAnnotations([{ start: -1, end: 2, label: 'Person' }], text).length, 1);
});

test('text mismatch is rejected', () => {
  const bad = { ...ann(0, 5), text: 'Alice' };
  bad.text = 'Wrong';
  assert.equal(validateAnnotations([bad], text).length, 1);
});

test('overlapping spans are rejected even when unsorted', () => {
  const errors = validateAnnotations([ann(10, 13), ann(0, 6)], text);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /overlap/i);
});

test('touching spans are allowed', () => {
  assert.deepEqual(validateAnnotations([ann(0, 5), ann(5, 8)], text), []);
});

test('non-array input is rejected', () => {
  assert.equal(validateAnnotations({}, text).length, 1);
});

--- apps/text-annotator/test/store.test.mjs ---
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../src/store.mjs';

const doc = {
  id: 'doc_0123456789ab',
  filename: 'sample.txt',
  ext: 'txt',
  text: 'Hello world.',
  paragraphs: [{ index: 0, text: 'Hello world.', start: 0, end: 12 }],
  warnings: [],
  createdAt: '2026-10-23T12:00:00.000Z',
  meta: { chars: 12, words: 2, paragraphs: 1 },
};

test('store saves, gets, lists and deletes a document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-store-'));
  try {
    const store = new Store(dir);
    await store.saveDocument(doc);

    const got = await store.getDocument(doc.id);
    assert.equal(got.text, doc.text);

    const list = await store.listDocuments();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, doc.id);
    assert.equal(list[0].chars, 12);
    assert.equal(list[0].annotations, 0);

    await store.deleteDocument(doc.id);
    await assert.rejects(
      () => store.getDocument(doc.id),
      (error) => error.code === 'NOT_FOUND',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('store saves and reads annotations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-store-'));
  try {
    const store = new Store(dir);
    await store.saveDocument(doc);
    const annotations = [{
      id: 'ann_0123456789ab',
      start: 0,
      end: 5,
      label: 'Person',
      text: 'Hello',
      createdAt: '2026-10-23T12:00:00.000Z',
    }];
    await store.saveAnnotations(doc.id, annotations);
    assert.deepEqual(await store.getAnnotations(doc.id), annotations);
    const list = await store.listDocuments();
    assert.equal(list[0].annotations, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('store rejects a traversal-shaped id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-store-'));
  try {
    const store = new Store(dir);
    await assert.rejects(
      () => store.getDocument('../secret'),
      (error) => error.code === 'NOT_FOUND',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

--- apps/text-annotator/test/api.test.mjs ---
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

    const res = await fetch(`${app.base}/api/documents/doc_ffffffffffff/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
