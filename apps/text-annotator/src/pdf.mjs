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
