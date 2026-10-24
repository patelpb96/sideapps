You are B1, the backend author. Apply minimal fixes for the independent review below. Return full contents for exactly these three files:
- apps/text-annotator/src/validate.mjs
- apps/text-annotator/src/docx.mjs
- apps/text-annotator/server.mjs

Do not change the public contract or the tests. Keep the existing behavior that passes. For the DOCX parser, replace the regex-based paragraph/token scan with a linear forward scan (no lazy `[\s\S]*?` rescanning) and enforce central-directory bounds. For validation, sort a copy before overlap checks. For the server, resolve the document before parsing the JSON body and validate supplied `id`/`createdAt` if present (or always regenerate them).

Return format: `FILE: <path>` followed by a fenced code block with the full file. No commentary.

REVIEW:
- **High** — `apps/text-annotator/src/validate.mjs` rejects unsorted, non-overlapping annotations.  
  Evidence: `if (hasPrevious && annotation.start < previousEnd) { errors.push(...overlaps...) }` and `previousEnd` is updated in input order. For `[{start:10,end:20}, {start:0,end:5}]`, this reports an overlap even though the spans are disjoint. `validateAnnotations` has no sorted-input precondition, and it is imported directly by tests.  
  Minimal fix: collect validated span records, sort a copy by `(start,end)`, and run the overlap check against that sorted copy; preserve original indices for error messages if needed.

- **Medium** — `apps/text-annotator/src/docx.mjs` has a synchronous CPU DoS in the XML regex parsing.  
  Evidence: `const tokenPattern = /<w:t(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:t>|.../g;` and the paragraph regex `/<w:p(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:p>|.../g`. For each unmatched opening tag, the lazy `[\s\S]*?` rescans toward EOF looking for a closing tag. A crafted 20 MiB `word/document.xml` containing many unclosed `<w:t>`/`<w:p>` tags can force quadratic work on the Node event loop; compression keeps the upload small.  
  Minimal fix: replace both regex parsers with a linear forward scanner/tokenizer and cap the number of parsed paragraphs/tokens; reject malformed XML instead of rescanning for every unmatched opening tag.

- **Low** — `apps/text-annotator/src/docx.mjs` does not fully enforce the declared central-directory bounds.  
  Evidence: after only `if (position + 46 > buffer.length)`, the code reads the entry, and only after processing it does:
  ```js
  position = nameStart + nameLength + extraLength + commentLength;
  if (position > centralOffset + centralSize) break;
  ```
  The current entry’s header/name/extra/comment fields are never required to fit inside `centralOffset + centralSize`; a malformed DOCX can place the target central entry outside the declared central directory and still have it parsed.  
  Minimal fix: compute `centralEnd = centralOffset + centralSize`, verify `centralEnd <= eocd`, and require `position + 46 <= centralEnd` plus `nameStart + nameLength + extraLength + commentLength <= centralEnd` before using each central entry.

- **Low** — `apps/text-annotator/server.mjs` checks the JSON body before checking that the document exists on `PUT /api/documents/:id/annotations`.  
  Evidence:
  ```js
  async function handlePutAnnotations(req, res, id, store) {
    const body = await readJsonBody(req);
    const document = await store.getDocument(id);
  ```
  A request for a missing document with malformed JSON returns `400 BAD_JSON` and with an oversized body returns `413 FILE_TOO_LARGE`, instead of the contract’s `404 NOT_FOUND` for a missing document.  
  Minimal fix: resolve `store.getDocument(id)` before parsing/validating the body, and drain/close the request body if returning early.

- **Low** — `apps/text-annotator/server.mjs` preserves invalid supplied annotation `id`/`createdAt` values, and `validateAnnotations` never checks them.  
  Evidence:
  ```js
  id: annotation.id === undefined ? newId('ann') : annotation.id,
  ...
  createdAt:
    annotation.createdAt === undefined ? now : annotation.createdAt,
  ```
  A request with `id: {}` or `createdAt: null` can be stored and returned as a valid annotation, violating the documented annotation shape (`id` string, `createdAt` timestamp) and the contract’s “invalid shape → 422” rule.  
  Minimal fix: if `id` or `createdAt` is present, validate its type/format and return `422 INVALID_ANNOTATIONS` on failure, or always replace them with server-generated values.

- **Info** — The backend contract does depend on the static artifact: the contract’s tests include “Static page and assets are served.” The server implements the static route correctly, so the reported static failure is only missing `public/index.html`/assets, not a B1 backend handler defect. The acceptance suite cannot fully pass until those files exist.


CURRENT FILE: apps/text-annotator/src/validate.mjs
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


CURRENT FILE: apps/text-annotator/src/docx.mjs
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


CURRENT FILE: apps/text-annotator/server.mjs
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
