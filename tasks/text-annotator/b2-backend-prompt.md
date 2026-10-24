You are B2, the independent backend reviewer for Text Annotator V1. You have no tools. Review the exact B1 bundle below against the contract. Do not rewrite the code. Report concrete findings only: severity, file and line or exact quote, why it is wrong, and the minimal fix. Focus on correctness, security, and the acceptance tests.

Current evidence: 25 tests pass, 0 skipped. One test fails because `public/index.html` and the frontend assets are not built yet; that is expected at the backend stage. PDF extraction works with the installed `pdftotext`. Ignore that static-file failure for this review, but say if the backend contract depends on it.

Check especially:
- `validateAnnotations` when input is unsorted but non-overlapping.
- annotation normalization and overlap detection in `server.mjs`.
- ZIP/ZIP64 bounds and decompression limits in `docx.mjs`.
- `pdftotext` missing/timeout/error mapping.
- body limits, filename decoding, path traversal in static serving and the store.
- HTTP status/code mapping and method handling.
- atomic writes and missing-document behavior.

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


B1 BUNDLE:
FILE: apps/text-annotator/package.json
```json
{
  "name": "text-annotator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "server.mjs",
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test"
  },
  "engines": {
    "node": ">=20"
  }
}
```

FILE: apps/text-annotator/src/id.mjs
```js
import { randomBytes } from 'node:crypto';

export function newId(prefix) {
  const safePrefix = typeof prefix === 'string' && prefix.length > 0 ? prefix : 'id';
  return `${safePrefix}_${randomBytes(6).toString('hex')}`;
}
```

FILE: apps/text-annotator/src/docx.mjs
```js
import { inflateRawSync } from 'node:zlib';

const MAX_XML_BYTES = 20 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function fail(message) {
  throw new Error(message);
}

function findEndOfCentralDirectory(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    fail('Invalid DOCX: data must be a Buffer');
  }

  const start = buffer.length - 22;
  const min = Math.max(0, buffer.length - 22 - 0xffff);

  for (let i = start; i >= min; i -= 1) {
    if (i < 0 || i + 4 > buffer.length) continue;
    if (buffer.readUInt32LE(i) !== EOCD_SIGNATURE) continue;

    const commentLength = buffer.readUInt16LE(i + 20);
    if (i + 22 + commentLength <= buffer.length) {
      return i;
    }
  }

  fail('Invalid DOCX: end of central directory not found');
}

function readZipEntry(buffer, wantedName) {
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail('Unsupported DOCX: ZIP64 archives are not supported');
  }

  if (centralOffset + centralSize > buffer.length) {
    fail('Invalid DOCX: central directory is out of bounds');
  }

  let position = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (position + 46 > buffer.length) {
      fail('Invalid DOCX: truncated central directory');
    }
    if (buffer.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
      fail('Invalid DOCX: invalid central directory entry');
    }

    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    const nameStart = position + 46;

    if (nameStart + nameLength > buffer.length) {
      fail('Invalid DOCX: truncated central directory filename');
    }

    const name = buffer
      .toString('utf8', nameStart, nameStart + nameLength)
      .replace(/\\/g, '/');

    if (name === wantedName) {
      if ((flags & 0x0001) !== 0) {
        fail('Invalid DOCX: encrypted ZIP entries are not supported');
      }
      if (method !== 0 && method !== 8) {
        fail('Invalid DOCX: unsupported ZIP compression method');
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        fail('Unsupported DOCX: ZIP64 entry is not supported');
      }
      if (uncompressedSize > MAX_XML_BYTES) {
        fail('DOCX document XML exceeds the 20 MiB limit');
      }
      if (localOffset + 30 > buffer.length) {
        fail('Invalid DOCX: local file header is out of bounds');
      }
      if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
        fail('Invalid DOCX: invalid local file header');
      }

      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;

      if (dataStart + compressedSize > buffer.length) {
        fail('Invalid DOCX: compressed entry data is out of bounds');
      }

      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let data;

      if (method === 0) {
        data = compressed;
      } else {
        try {
          data = inflateRawSync(compressed, {
            maxOutputLength: MAX_XML_BYTES + 1,
          });
        } catch {
          fail('Invalid DOCX: could not decompress word/document.xml');
        }
      }

      if (data.length > MAX_XML_BYTES) {
        fail('DOCX document XML exceeds the 20 MiB limit');
      }

      return data.toString('utf8');
    }

    position = nameStart + nameLength + extraLength + commentLength;
    if (position > centralOffset + centralSize) {
      break;
    }
  }

  fail('Invalid DOCX: word/document.xml was not found');
}

function decodeXmlEntities(value) {
  if (!value.includes('&')) return value;

  return value.replace(
    /&(#(?:x|X)[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (match, entity) => {
      if (entity[0] === '#') {
        const isHex = entity[1] === 'x' || entity[1] === 'X';
        const digits = isHex ? entity.slice(2) : entity.slice(1);
        const codePoint = Number.parseInt(digits, isHex ? 16 : 10);

        if (
          !Number.isInteger(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return '\uFFFD';
        }

        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return '\uFFFD';
        }
      }

      switch (entity) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return match;
      }
    },
  );
}

function parseParagraph(xml) {
  const tokenPattern =
    /<w:t(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*?)?\/>|<w:(tab|br|cr)(?:\s[^>]*?)?\/?>/g;

  let output = '';
  let match;

  while ((match = tokenPattern.exec(xml)) !== null) {
    if (match[1] !== undefined) {
      output += decodeXmlEntities(match[1]);
    } else if (match[2] === 'tab') {
      output += '\t';
    } else if (match[2] === 'br' || match[2] === 'cr') {
      output += '\n';
    }
  }

  return output;
}

export function extractDocx(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml');
  const paragraphs = [];
  const paragraphPattern =
    /<w:p(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*?)?\/>/g;

  let match;

  while ((match = paragraphPattern.exec(xml)) !== null) {
    paragraphs.push(parseParagraph(match[1] ?? ''));
  }

  return paragraphs;
}
```

FILE: apps/text-annotator/src/pdf.mjs
```js
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PDF_TIMEOUT_MS = 20_000;
const PDF_MAX_STDOUT_BYTES = 10 * 1024 * 1024;

function splitPdfText(output) {
  const normalized = String(output ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\f+/g, '\n\n');

  return normalized
    .split(/\n[^\S\n]*\n+/)
    .map((paragraph) => paragraph.replace(/\s+$/u, ''))
    .filter((paragraph) => paragraph.length > 0);
}

export async function extractPdf(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'text-annotator-pdf-'));
  const tempFile = join(dir, 'document.pdf');

  try {
    await writeFile(tempFile, buffer);

    let stdout;

    try {
      const result = await execFileAsync(
        'pdftotext',
        ['-layout', '-enc', 'UTF-8', tempFile, '-'],
        {
          encoding: 'utf8',
          timeout: PDF_TIMEOUT_MS,
          maxBuffer: PDF_MAX_STDOUT_BYTES,
          windowsHide: true,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.errno === 'ENOENT')) {
        const missing = new Error('pdftotext is not installed or is not available on PATH');
        missing.code = 'PDF_TOOL_MISSING';
        throw missing;
      }
      throw error;
    }

    return splitPdfText(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

FILE: apps/text-annotator/src/extract.mjs
```js
import { extractDocx } from './docx.mjs';
import { extractPdf } from './pdf.mjs';

const STATUS_BY_CODE = {
  BAD_FILENAME: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  NO_TEXT: 422,
  PDF_TOOL_MISSING: 422,
  EXTRACT_FAILED: 422,
  INTERNAL: 500,
};

const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'docx', 'pdf']);

export class ExtractError extends Error {
  constructor(code, message, status) {
    super(message ?? code);
    this.name = 'ExtractError';
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code] ?? 500;
  }
}

function extensionOf(filename) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new ExtractError('BAD_FILENAME', 'A filename is required', 400);
  }

  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function splitPlainTextParagraphs(text) {
  return text.split(/\n[^\S\n]*\n+/);
}

function buildExtraction(ext, rawParagraphs, warnings) {
  const paragraphs = [];
  let text = '';

  if (Array.isArray(rawParagraphs)) {
    for (const rawParagraph of rawParagraphs) {
      const value = typeof rawParagraph === 'string' ? rawParagraph : String(rawParagraph ?? '');
      const paragraphText = value.replace(/\s+$/u, '');

      if (paragraphText.length === 0) continue;

      if (paragraphs.length > 0) {
        text += '\n\n';
      }

      const start = text.length;
      text += paragraphText;
      const end = text.length;

      paragraphs.push({
        index: paragraphs.length,
        text: paragraphText,
        start,
        end,
      });
    }
  }

  if (paragraphs.length === 0) {
    throw new ExtractError('NO_TEXT', 'No text could be extracted from this file.', 422);
  }

  return {
    ext,
    text,
    paragraphs,
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

export async function extractDocument({ buffer, filename } = {}) {
  const ext = extensionOf(filename);

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new ExtractError(
      'UNSUPPORTED_FORMAT',
      `Unsupported file format: ${ext || 'unknown'}`,
      415,
    );
  }

  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '');

  if (ext === 'txt' || ext === 'md') {
    let text = bytes.toString('utf8');

    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    text = text.replace(/\r\n?/g, '\n');

    return buildExtraction(ext, splitPlainTextParagraphs(text), []);
  }

  if (ext === 'docx') {
    let paragraphs;

    try {
      paragraphs = extractDocx(bytes);
    } catch (error) {
      if (error instanceof ExtractError) throw error;
      throw new ExtractError(
        'EXTRACT_FAILED',
        `Failed to read DOCX: ${error?.message ?? 'unknown error'}`,
        422,
      );
    }

    return buildExtraction(ext, paragraphs, []);
  }

  let paragraphs;

  try {
    paragraphs = await extractPdf(bytes);
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    if (error && error.code === 'PDF_TOOL_MISSING') {
      throw new ExtractError(
        'PDF_TOOL_MISSING',
        error.message || 'pdftotext is not installed.',
        422,
      );
    }
    throw new ExtractError(
      'EXTRACT_FAILED',
      `Failed to read PDF: ${error?.message ?? 'unknown error'}`,
      422,
    );
  }

  return buildExtraction(ext, paragraphs, []);
}
```

FILE: apps/text-annotator/src/validate.mjs
```js
export const LABELS = [
  'Person',
  'Organization',
  'Location',
  'Date',
  'Amount',
  'Other',
];

export function validateAnnotations(annotations, text) {
  if (!Array.isArray(annotations)) {
    return ['annotations must be an array'];
  }

  const documentText = typeof text === 'string' ? text : '';
  const errors = [];

  let previousEnd = 0;
  let hasPrevious = false;

  for (let i = 0; i < annotations.length; i += 1) {
    const annotation = annotations[i];
    const where = `annotations[${i}]`;

    if (
      annotation === null ||
      typeof annotation !== 'object' ||
      Array.isArray(annotation)
    ) {
      errors.push(`${where} must be an object`);
      continue;
    }

    if (!Number.isInteger(annotation.start)) {
      errors.push(`${where}.start must be an integer`);
      continue;
    }

    if (annotation.start < 0) {
      errors.push(`${where}.start must be greater than or equal to 0`);
      continue;
    }

    if (!Number.isInteger(annotation.end)) {
      errors.push(`${where}.end must be an integer`);
      continue;
    }

    if (annotation.end <= annotation.start) {
      errors.push(`${where}.end must be greater than start`);
      continue;
    }

    if (annotation.end > documentText.length) {
      errors.push(`${where}.end must be less than or equal to the document text length`);
      continue;
    }

    if (!LABELS.includes(annotation.label)) {
      errors.push(`${where}.label must be one of ${LABELS.join(', ')}`);
    }

    if (annotation.text !== undefined) {
      const expected = documentText.slice(annotation.start, annotation.end);
      if (typeof annotation.text !== 'string' || annotation.text !== expected) {
        errors.push(
          `${where}.text does not match the document text for [${annotation.start}, ${annotation.end})`,
        );
      }
    }

    if (hasPrevious && annotation.start < previousEnd) {
      errors.push(`${where} overlaps a previous annotation`);
    }

    if (!hasPrevious || annotation.end > previousEnd) {
      previousEnd = annotation.end;
    }
    hasPrevious = true;
  }

  return errors;
}
```

FILE: apps/text-annotator/src/store.mjs
```js
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

class StoreError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.status = status;
  }
}

function notFoundError() {
  return new StoreError('NOT_FOUND', 'Document not found', 404);
}

function assertSafeId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw notFoundError();
  }
  return id;
}

function compareAnnotationSpans(a, b) {
  const aStart = a && Number.isFinite(a.start) ? a.start : Number.MAX_SAFE_INTEGER;
  const bStart = b && Number.isFinite(b.start) ? b.start : Number.MAX_SAFE_INTEGER;

  if (aStart !== bStart) return aStart - bStart;

  const aEnd = a && Number.isFinite(a.end) ? a.end : Number.MAX_SAFE_INTEGER;
  const bEnd = b && Number.isFinite(b.end) ? b.end : Number.MAX_SAFE_INTEGER;

  if (aEnd !== bEnd) return aEnd - bEnd;

  return 0;
}

function sortAnnotations(annotations) {
  return annotations.slice().sort(compareAnnotationSpans);
}

async function writeJsonAtomic(file, value) {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempFile = `${file}.${suffix}.tmp`;

  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

  try {
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

export class Store {
  constructor(dir) {
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new TypeError('Store directory is required');
    }

    this.dir = dir;
    this.documentsDir = join(dir, 'documents');
    this.annotationsDir = join(dir, 'annotations');
  }

  documentPath(id) {
    return join(this.documentsDir, `${id}.json`);
  }

  annotationPath(id) {
    return join(this.annotationsDir, `${id}.json`);
  }

  async saveDocument(document) {
    if (!document || typeof document !== 'object') {
      throw new TypeError('Document must be an object');
    }

    assertSafeId(document.id);
    await mkdir(this.documentsDir, { recursive: true });
    await writeJsonAtomic(this.documentPath(document.id), document);
  }

  async getDocument(id) {
    assertSafeId(id);

    let raw;

    try {
      raw = await readFile(this.documentPath(id), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw notFoundError();
      throw error;
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError('INTERNAL', 'Document data is corrupt', 500);
    }
  }

  async listDocuments() {
    let entries;

    try {
      entries = await readdir(this.documentsDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const documents = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const id = entry.name.slice(0, -5);
      if (!SAFE_ID.test(id)) continue;

      let document;

      try {
        document = JSON.parse(await readFile(this.documentPath(id), 'utf8'));
      } catch {
        continue;
      }

      let annotationCount = 0;

      try {
        const parsed = JSON.parse(await readFile(this.annotationPath(id), 'utf8'));
        if (Array.isArray(parsed)) annotationCount = parsed.length;
      } catch {
        annotationCount = 0;
      }

      const chars =
        typeof document.meta?.chars === 'number'
          ? document.meta.chars
          : typeof document.text === 'string'
            ? document.text.length
            : 0;

      documents.push({
        id: typeof document.id === 'string' ? document.id : id,
        filename: document.filename,
        ext: document.ext,
        chars,
        annotations: annotationCount,
        createdAt: document.createdAt,
      });
    }

    documents.sort((a, b) => {
      const aCreated = String(a.createdAt ?? '');
      const bCreated = String(b.createdAt ?? '');
      if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
      return String(a.id).localeCompare(String(b.id));
    });

    return documents;
  }

  async deleteDocument(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      return false;
    }

    let deleted = false;

    try {
      await unlink(this.documentPath(id));
      deleted = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    try {
      await unlink(this.annotationPath(id));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    return deleted;
  }

  async saveAnnotations(id, annotations) {
    assertSafeId(id);

    if (!Array.isArray(annotations)) {
      throw new TypeError('Annotations must be an array');
    }

    await mkdir(this.annotationsDir, { recursive: true });

    const sorted = sortAnnotations(annotations);
    await writeJsonAtomic(this.annotationPath(id), sorted);

    return sorted;
  }

  async getAnnotations(id) {
    assertSafeId(id);

    let raw;

    try {
      raw = await readFile(this.annotationPath(id), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new StoreError('INTERNAL', 'Annotation data is corrupt', 500);
    }
  }
}
```

FILE: apps/text-annotator/server.mjs
```js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { ExtractError, extractDocument } from './src/extract.mjs';
import { newId } from './src/id.mjs';
import { Store } from './src/store.mjs';
import { validateAnnotations } from './src/validate.mjs';

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const JSON_BODY_LIMIT = 10 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;

  const body = JSON.stringify(payload);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, {
    error: {
      code,
      message,
    },
  });
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
}

function decodeFilenameHeader(value) {
  let raw = value;

  if (Array.isArray(raw)) {
    raw = raw[0];
  }

  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  let decoded;

  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }

  if (decoded.length === 0) return null;
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (decoded.includes('/') || decoded.includes('\\')) return null;

  return decoded;
}

function readBody(req, limit) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      total += chunk.length;

      if (total > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      resolvePromise({
        buffer: Buffer.concat(chunks),
        size: total,
        tooLarge,
      });
    });

    req.on('error', rejectPromise);
    req.on('aborted', () => {
      rejectPromise(new HttpError(400, 'BAD_REQUEST', 'Request was aborted'));
    });
  });
}

async function readJsonBody(req) {
  const body = await readBody(req, JSON_BODY_LIMIT);

  if (body.tooLarge) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'Request body is too large');
  }

  let raw = body.buffer.toString('utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
}

function comparePreparedAnnotations(a, b) {
  const aStart = a && Number.isFinite(a.start) ? a.start : Number.MAX_SAFE_INTEGER;
  const bStart = b && Number.isFinite(b.start) ? b.start : Number.MAX_SAFE_INTEGER;

  if (aStart !== bStart) return aStart - bStart;

  const aEnd = a && Number.isFinite(a.end) ? a.end : Number.MAX_SAFE_INTEGER;
  const bEnd = b && Number.isFinite(b.end) ? b.end : Number.MAX_SAFE_INTEGER;

  if (aEnd !== bEnd) return aEnd - bEnd;

  return 0;
}

function prepareAnnotations(rawAnnotations, text) {
  const now = new Date().toISOString();

  const prepared = rawAnnotations.map((annotation) => {
    if (
      annotation === null ||
      typeof annotation !== 'object' ||
      Array.isArray(annotation)
    ) {
      return annotation;
    }

    const next = {
      id: annotation.id === undefined ? newId('ann') : annotation.id,
      start: annotation.start,
      end: annotation.end,
      label: annotation.label,
      createdAt:
        annotation.createdAt === undefined ? now : annotation.createdAt,
    };

    if (annotation.text === undefined) {
      if (
        Number.isInteger(annotation.start) &&
        Number.isInteger(annotation.end) &&
        annotation.start >= 0 &&
        annotation.end >= annotation.start &&
        annotation.end <= text.length
      ) {
        next.text = text.slice(annotation.start, annotation.end);
      }
    } else {
      next.text = annotation.text;
    }

    return next;
  });

  prepared.sort(comparePreparedAnnotations);
  return prepared;
}

async function handleUpload(req, res, store, maxBytes) {
  const filename = decodeFilenameHeader(req.headers['x-filename']);
  const body = await readBody(req, maxBytes);

  if (body.tooLarge) {
    sendError(
      res,
      413,
      'FILE_TOO_LARGE',
      `Files must be at most ${maxBytes} bytes`,
    );
    return;
  }

  if (!filename) {
    sendError(
      res,
      400,
      'BAD_FILENAME',
      'The X-Filename header must contain an encoded filename',
    );
    return;
  }

  let extracted;

  try {
    extracted = await extractDocument({
      buffer: body.buffer,
      filename,
    });
  } catch (error) {
    if (error instanceof ExtractError) {
      sendError(res, error.status, error.code, error.message);
      return;
    }
    throw error;
  }

  const document = {
    id: newId('doc'),
    filename,
    ext: extracted.ext,
    text: extracted.text,
    paragraphs: extracted.paragraphs,
    warnings: extracted.warnings,
    createdAt: new Date().toISOString(),
    meta: {
      chars: extracted.text.length,
      words: countWords(extracted.text),
      paragraphs: extracted.paragraphs.length,
    },
  };

  await store.saveDocument(document);

  sendJson(res, 201, { document });
}

async function handlePutAnnotations(req, res, id, store) {
  const body = await readJsonBody(req);
  const document = await store.getDocument(id);

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !Array.isArray(body.annotations)
  ) {
    sendError(
      res,
      422,
      'INVALID_ANNOTATIONS',
      'annotations must be an array',
    );
    return;
  }

  const prepared = prepareAnnotations(body.annotations, document.text);
  const errors = validateAnnotations(prepared, document.text);

  if (errors.length > 0) {
    sendError(res, 422, 'INVALID_ANNOTATIONS', errors[0]);
    return;
  }

  await store.saveAnnotations(id, prepared);

  sendJson(res, 200, { annotations: prepared });
}

async function serveStatic(req, res, publicRoot, pathname) {
  if (!publicRoot) {
    sendError(res, 404, 'NOT_FOUND', 'Not found');
    return;
  }

  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relativePath.length === 0) relativePath = 'index.html';

  if (relativePath.includes('\u0000')) {
    sendError(res, 404, 'NOT_FOUND', 'Not found');
    return;
  }

  const filePath = resolve(publicRoot, relativePath);
  const rel = relative(publicRoot, filePath);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    sendError(res, 404, 'NOT_FOUND', 'Not found');
    return;
  }

  let data;

  try {
    data = await readFile(filePath);
  } catch (error) {
    if (
      error.code === 'ENOENT' ||
      error.code === 'EISDIR' ||
      error.code === 'ENOTDIR'
    ) {
      sendError(res, 404, 'NOT_FOUND', 'Not found');
      return;
    }
    throw error;
  }

  const contentType =
    MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(data);
  }
}

async function handleRequest(req, res, store, publicRoot, maxBytes) {
  const method = (req.method ?? 'GET').toUpperCase();

  let url;

  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid request URL');
  }

  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid URL encoding');
  }

  if (pathname === '/api/documents') {
    if (method === 'POST') {
      await handleUpload(req, res, store, maxBytes);
      return;
    }

    if (method === 'GET') {
      const documents = await store.listDocuments();
      sendJson(res, 200, { documents });
      return;
    }

    methodNotAllowed(res, ['GET', 'POST']);
    return;
  }

  const annotationsMatch = /^\/api\/documents\/([^/]+)\/annotations$/.exec(pathname);

  if (annotationsMatch) {
    const id = annotationsMatch[1];

    if (method === 'GET') {
      await store.getDocument(id);
      const annotations = await store.getAnnotations(id);
      sendJson(res, 200, { annotations });
      return;
    }

    if (method === 'PUT') {
      await handlePutAnnotations(req, res, id, store);
      return;
    }

    methodNotAllowed(res, ['GET', 'PUT']);
    return;
  }

  const documentMatch = /^\/api\/documents\/([^/]+)$/.exec(pathname);

  if (documentMatch) {
    const id = documentMatch[1];

    if (method === 'GET') {
      const document = await store.getDocument(id);
      sendJson(res, 200, { document });
      return;
    }

    if (method === 'DELETE') {
      const deleted = await store.deleteDocument(id);

      if (!deleted) {
        sendError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      res.writeHead(204);
      res.end();
      return;
    }

    methodNotAllowed(res, ['GET', 'DELETE']);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendError(res, 404, 'NOT_FOUND', 'Not found');
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    methodNotAllowed(res, ['GET', 'HEAD']);
    return;
  }

  await serveStatic(req, res, publicRoot, pathname);
}

function handleError(res, error) {
  if (res.writableEnded) return;

  if (res.headersSent) {
    res.destroy();
    return;
  }

  if (
    error &&
    Number.isInteger(error.status) &&
    typeof error.code === 'string'
  ) {
    sendError(res, error.status, error.code, error.message || error.code);
    return;
  }

  sendError(res, 500, 'INTERNAL', 'Unexpected server error');
}

export function createServer({ store, publicDir, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const publicRoot = publicDir ? resolve(publicDir) : null;
  const limit =
    Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : DEFAULT_MAX_BYTES;

  const server = http.createServer((req, res) => {
    handleRequest(req, res, store, publicRoot, limit).catch((error) => {
      handleError(res, error);
    });
  });

  server.on('clientError', (error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  return server;
}

const modulePath = fileURLToPath(import.meta.url);
const isMain =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === modulePath;

if (isMain) {
  const appRoot = dirname(modulePath);
  const store = new Store(join(appRoot, 'data'));
  const publicDir = join(appRoot, 'public');

  let port = 4174;

  if (process.env.PORT !== undefined && process.env.PORT !== '') {
    const parsed = Number(process.env.PORT);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
      port = parsed;
    }
  }

  const server = createServer({
    store,
    publicDir,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  server.listen(port, () => {
    const address = server.address();
    const actualPort =
      address && typeof address === 'object' ? address.port : port;
    console.log(`Text Annotator listening on http://localhost:${actualPort}`);
  });
}
```
