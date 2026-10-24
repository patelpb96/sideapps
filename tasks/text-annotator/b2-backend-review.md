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
