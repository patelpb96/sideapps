You are a frontend consumer agent reviewing backend readiness. You have no tools and see only this packet. Do not write code yet. Decide whether the backend contract is sufficient for the V1 UI: upload/drop, document list, text viewer, selection-to-offset, labels, annotation list/delete, export JSON, error states, persistence. Return JSON only:

{"decision":"ACK|NACK","readiness_hash":"<from packet>","contract_hash":"<from packet>","findings":["<specific gap or empty>"]}

ACK means you accept the exact hashes and can build against them. NACK means a gap blocks frontend work. Do not ACK a hash you were not given.

BACKEND EVIDENCE
- 25 backend tests pass, 0 fail, 0 skipped (the static-page test is excluded until the frontend exists).
- PDF extraction uses the installed pdftotext text layer; no OCR.
- TXT/MD/DOCX/PDF extraction, annotation validation, store, and API are covered.

READINESS:
{
  "task": "text-annotator-v1",
  "phase": "backend-ready",
  "backend_tree": "38128e40dbb63fec228aca9bdb56804bac130affd6d7e16e81424d0f13cba61e",
  "backend_tests": "3ebd0a1b7fe5a0c7087d36e174fb3585efc31f9fa7625857b0be254af5da6449",
  "contract_hash": "031457eac343a0a35bb32a19a8a93c068ce3adb07d9d1224d55e5af78f15b853",
  "test_evidence": "3ab66b968061af931c8ad84c3a9b0dc82e37f70c4abc2a72de3f78e00e33d054",
  "test_summary": "25 pass, 0 fail, 0 skipped; static frontend test intentionally excluded until the frontend exists",
  "frontend_grant_required": true,
  "readiness_hash": "efd7268f12a44b34c5dd50764f3bd3b3024deb22b72a953852b118593077aa40"
}


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
