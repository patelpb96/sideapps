import { inflateRawSync } from 'node:zlib';

const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_PARAGRAPHS = 100_000;
const MAX_TEXT_TOKENS = 1_000_000;
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

  const centralEnd = centralOffset + centralSize;

  if (centralEnd > eocd || centralEnd > buffer.length) {
    fail('Invalid DOCX: central directory is out of bounds');
  }

  let position = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (position + 46 > centralEnd) {
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
    const nextPosition = nameStart + nameLength + extraLength + commentLength;

    if (nextPosition > centralEnd) {
      fail('Invalid DOCX: central directory entry is out of bounds');
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

    position = nextPosition;
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

function isXmlSpace(code) {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

function findTagEnd(xml, start) {
  let quote = 0;

  for (let i = start; i < xml.length; i += 1) {
    const code = xml.charCodeAt(i);

    if (quote !== 0) {
      if (code === quote) quote = 0;
      continue;
    }

    if (code === 0x22 || code === 0x27) {
      quote = code;
      continue;
    }

    if (code === 0x3e) {
      return i;
    }
  }

  return -1;
}

function parseTag(raw) {
  let nameEnd = 0;

  while (nameEnd < raw.length) {
    const code = raw.charCodeAt(nameEnd);
    if (isXmlSpace(code) || code === 0x2f) break;
    nameEnd += 1;
  }

  let contentEnd = raw.length;

  while (contentEnd > 0 && isXmlSpace(raw.charCodeAt(contentEnd - 1))) {
    contentEnd -= 1;
  }

  return {
    name: raw.slice(0, nameEnd),
    selfClosing: contentEnd > 0 && raw.charCodeAt(contentEnd - 1) === 0x2f,
  };
}

function extractParagraphs(xml) {
  const paragraphs = [];
  const openParagraphs = [];
  let tokenCount = 0;
  let position = 0;

  while (position < xml.length) {
    const tagStart = xml.indexOf('<', position);

    if (tagStart === -1) break;
    position = tagStart;

    if (xml.startsWith('<!--', position)) {
      const end = xml.indexOf('-->', position + 4);
      if (end === -1) fail('Invalid DOCX: unclosed XML comment');
      position = end + 3;
      continue;
    }

    if (xml.startsWith('<![CDATA[', position)) {
      const end = xml.indexOf(']]>', position + 9);
      if (end === -1) fail('Invalid DOCX: unclosed XML CDATA section');
      position = end + 3;
      continue;
    }

    if (xml.startsWith('<?', position)) {
      const end = xml.indexOf('?>', position + 2);
      if (end === -1) fail('Invalid DOCX: unclosed XML processing instruction');
      position = end + 2;
      continue;
    }

    if (xml.startsWith('<!', position)) {
      const end = findTagEnd(xml, position + 2);
      if (end === -1) fail('Invalid DOCX: unclosed XML declaration');
      position = end + 1;
      continue;
    }

    if (xml.charCodeAt(position + 1) === 0x2f) {
      const end = findTagEnd(xml, position + 2);
      if (end === -1) fail('Invalid DOCX: unclosed XML end tag');

      const { name } = parseTag(xml.slice(position + 2, end));
      position = end + 1;

      if (name === 'w:p') {
        if (openParagraphs.length === 0) {
          fail('Invalid DOCX: mismatched paragraph tags');
        }

        const parts = openParagraphs.pop();
        paragraphs.push(parts.join(''));
      } else if (name === 'w:t') {
        fail('Invalid DOCX: mismatched text tags');
      }

      continue;
    }

    const end = findTagEnd(xml, position + 1);
    if (end === -1) fail('Invalid DOCX: unclosed XML tag');

    const { name, selfClosing } = parseTag(xml.slice(position + 1, end));
    position = end + 1;

    if (name.length === 0) {
      fail('Invalid DOCX: malformed XML tag');
    }

    if (name === 'w:t') {
      tokenCount += 1;
      if (tokenCount > MAX_TEXT_TOKENS) {
        fail('Invalid DOCX: too many text tokens');
      }

      if (selfClosing) continue;

      const closeStart = xml.indexOf('</w:t>', position);
      if (closeStart === -1) fail('Invalid DOCX: unclosed text element');

      const content = xml.slice(position, closeStart);
      if (content.includes('<')) {
        fail('Invalid DOCX: malformed text element');
      }

      if (content.length > 0 && openParagraphs.length > 0) {
        openParagraphs[openParagraphs.length - 1].push(
          decodeXmlEntities(content),
        );
      }

      position = closeStart + 6;
      continue;
    }

    if (name === 'w:p') {
      if (paragraphs.length + openParagraphs.length >= MAX_PARAGRAPHS) {
        fail('Invalid DOCX: too many paragraphs');
      }

      if (selfClosing) {
        paragraphs.push('');
      } else {
        openParagraphs.push([]);
      }

      continue;
    }

    if (name === 'w:tab' || name === 'w:br' || name === 'w:cr') {
      tokenCount += 1;
      if (tokenCount > MAX_TEXT_TOKENS) {
        fail('Invalid DOCX: too many text tokens');
      }

      if (openParagraphs.length > 0) {
        openParagraphs[openParagraphs.length - 1].push(
          name === 'w:tab' ? '\t' : '\n',
        );
      }
    }
  }

  if (openParagraphs.length > 0) {
    fail('Invalid DOCX: unclosed paragraph element');
  }

  return paragraphs;
}

export function extractDocx(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml');
  return extractParagraphs(xml);
}
