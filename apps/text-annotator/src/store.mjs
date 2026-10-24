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
