# Brief — Text Annotator V1

## Goal

A local web app that loads a text document and lets one person label spans of
text. It is the first test program for the program factory.

## Inputs

- `.txt`, `.md` — UTF-8 text.
- `.docx` — read `word/document.xml`; no external converter.
- `.pdf` — extract the existing text layer with `pdftotext`; no OCR.
- Maximum file size: 25 MiB.

If a PDF or DOCX has no text layer, return a clear error. "Bad luck" is an
acceptable outcome as long as it is not a crash and the UI says why.

## Users

One analyst, working locally. They upload a document, read it, select text,
apply a label, review the annotation list, and export the result as JSON.

## Labels

`Person`, `Organization`, `Location`, `Date`, `Amount`, `Other`.

## Outputs

- Extracted text with paragraph offsets.
- Annotations: `start`, `end`, `label`, exact `text`.
- Annotations persist per document and export as JSON.

## Acceptance

- Upload each supported format. TXT/MD/DOCX work without network or converter
  tools. PDF works when `pdftotext` is installed.
- A scanned PDF, an empty file, or a textless DOCX returns a 422 with a
  readable message; it does not crash the server.
- Selecting text creates a non-overlapping annotation whose `text` exactly
  matches `document.text.slice(start, end)`.
- Annotations survive a page reload and export as JSON.
- `node --test` passes.

## Non-goals

OCR, multi-user collaboration, authentication, cloud storage, rich-text
editing, overlapping spans, model-assisted labeling, and old binary `.doc`.
