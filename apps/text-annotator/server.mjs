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

function discardRequestBody(req) {
  req.on('error', () => {});
  req.resume();
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

function validateAnnotationMetadata(annotations) {
  for (let i = 0; i < annotations.length; i += 1) {
    const annotation = annotations[i];

    if (
      annotation === null ||
      typeof annotation !== 'object' ||
      Array.isArray(annotation)
    ) {
      continue;
    }

    if (annotation.id !== undefined && typeof annotation.id !== 'string') {
      return `annotations[${i}].id must be a string`;
    }

    if (annotation.createdAt !== undefined) {
      if (
        typeof annotation.createdAt !== 'string' ||
        Number.isNaN(Date.parse(annotation.createdAt))
      ) {
        return `annotations[${i}].createdAt must be a valid timestamp`;
      }
    }
  }

  return null;
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
  let document;

  try {
    document = await store.getDocument(id);
  } catch (error) {
    discardRequestBody(req);
    throw error;
  }

  const body = await readJsonBody(req);

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

  const metadataError = validateAnnotationMetadata(body.annotations);

  if (metadataError !== null) {
    sendError(res, 422, 'INVALID_ANNOTATIONS', metadataError);
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
