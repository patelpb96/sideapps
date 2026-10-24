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
