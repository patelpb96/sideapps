import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { extractDocument, ExtractError } from '../src/extract.mjs';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const hasPdfTool = () => {
  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  return !probe.error;
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
