You are B2, an independent backend reviewer. You have no tools. A previous review found the issues below; B1's fix diff follows. Decide whether each issue is actually fixed by the diff. Reply in plain text, one line per issue: `FIXED` or `STILL BROKEN: <reason>`. Do not call tools. Do not rewrite code. If everything is fixed, reply exactly `PASS`.

ORIGINAL FINDINGS:
1. validateAnnotations rejects unsorted non-overlapping input.
2. DOCX regex parsing can be quadratic on unclosed tags.
3. DOCX central-directory bounds are incomplete.
4. PUT annotations parses the body before checking whether the document exists.
5. Supplied annotation id/createdAt are not type-validated.

DIFFS:

--- validate.mjs ---
--- tasks/text-annotator/stage/src/validate.mjs	2026-10-23 16:12:04.658675300 -0700
+++ tasks/text-annotator/stage2/src/validate.mjs	2026-10-23 16:26:15.033995800 -0700
@@ -13,14 +13,13 @@
   }
 
   const documentText = typeof text === 'string' ? text : '';
-  const errors = [];
-
-  let previousEnd = 0;
-  let hasPrevious = false;
+  const errorsByIndex = Array.from({ length: annotations.length }, () => []);
+  const spans = [];
 
   for (let i = 0; i < annotations.length; i += 1) {
     const annotation = annotations[i];
     const where = `annotations[${i}]`;
+    const errors = errorsByIndex[i];
 
     if (
       annotation === null ||
@@ -69,15 +68,37 @@
       }
     }
 
-    if (hasPrevious && annotation.start < previousEnd) {
-      errors.push(`${where} overlaps a previous annotation`);
+    spans.push({
+      start: annotation.start,
+      end: annotation.end,
+      index: i,
+    });
+  }
+
+  const sortedSpans = spans
+    .slice()
+    .sort(
+      (a, b) =>
+        a.start - b.start ||
+        a.end - b.end ||
+        a.index - b.index,
+    );
+
+  let previousEnd = 0;
+  let hasPrevious = false;
+
+  for (const span of sortedSpans) {
+    if (hasPrevious && span.start < previousEnd) {
+      errorsByIndex[span.index].push(
+        `annotations[${span.index}] overlaps a previous annotation`,
+      );
     }
 
-    if (!hasPrevious || annotation.end > previousEnd) {
-      previousEnd = annotation.end;
+    if (!hasPrevious || span.end > previousEnd) {
+      previousEnd = span.end;
     }
     hasPrevious = true;
   }
 
-  return errors;
+  return errorsByIndex.flat();
 }

--- docx.mjs ---
--- tasks/text-annotator/stage/src/docx.mjs	2026-10-23 16:12:04.657672900 -0700
+++ tasks/text-annotator/stage2/src/docx.mjs	2026-10-23 16:26:15.033995800 -0700
@@ -1,6 +1,8 @@
 import { inflateRawSync } from 'node:zlib';
 
 const MAX_XML_BYTES = 20 * 1024 * 1024;
+const MAX_PARAGRAPHS = 100_000;
+const MAX_TEXT_TOKENS = 1_000_000;
 const EOCD_SIGNATURE = 0x06054b50;
 const CENTRAL_SIGNATURE = 0x02014b50;
 const LOCAL_SIGNATURE = 0x04034b50;
@@ -40,14 +42,16 @@
     fail('Unsupported DOCX: ZIP64 archives are not supported');
   }
 
-  if (centralOffset + centralSize > buffer.length) {
+  const centralEnd = centralOffset + centralSize;
+
+  if (centralEnd > eocd || centralEnd > buffer.length) {
     fail('Invalid DOCX: central directory is out of bounds');
   }
 
   let position = centralOffset;
 
   for (let i = 0; i < totalEntries; i += 1) {
-    if (position + 46 > buffer.length) {
+    if (position + 46 > centralEnd) {
       fail('Invalid DOCX: truncated central directory');
     }
     if (buffer.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
@@ -63,9 +67,10 @@
     const commentLength = buffer.readUInt16LE(position + 32);
     const localOffset = buffer.readUInt32LE(position + 42);
     const nameStart = position + 46;
+    const nextPosition = nameStart + nameLength + extraLength + commentLength;
 
-    if (nameStart + nameLength > buffer.length) {
-      fail('Invalid DOCX: truncated central directory filename');
+    if (nextPosition > centralEnd) {
+      fail('Invalid DOCX: central directory entry is out of bounds');
     }
 
     const name = buffer
@@ -122,10 +127,7 @@
       return data.toString('utf8');
     }
 
-    position = nameStart + nameLength + extraLength + commentLength;
-    if (position > centralOffset + centralSize) {
-      break;
-    }
+    position = nextPosition;
   }
 
   fail('Invalid DOCX: word/document.xml was not found');
@@ -176,37 +178,188 @@
   );
 }
 
-function parseParagraph(xml) {
-  const tokenPattern =
-    /<w:t(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*?)?\/>|<w:(tab|br|cr)(?:\s[^>]*?)?\/?>/g;
+function isXmlSpace(code) {
+  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
+}
+
+function findTagEnd(xml, start) {
+  let quote = 0;
 
-  let output = '';
-  let match;
+  for (let i = start; i < xml.length; i += 1) {
+    const code = xml.charCodeAt(i);
+
+    if (quote !== 0) {
+      if (code === quote) quote = 0;
+      continue;
+    }
+
+    if (code === 0x22 || code === 0x27) {
+      quote = code;
+      continue;
+    }
 
-  while ((match = tokenPattern.exec(xml)) !== null) {
-    if (match[1] !== undefined) {
-      output += decodeXmlEntities(match[1]);
-    } else if (match[2] === 'tab') {
-      output += '\t';
-    } else if (match[2] === 'br' || match[2] === 'cr') {
-      output += '\n';
+    if (code === 0x3e) {
+      return i;
     }
   }
 
-  return output;
+  return -1;
 }
 
-export function extractDocx(buffer) {
-  const xml = readZipEntry(buffer, 'word/document.xml');
+function parseTag(raw) {
+  let nameEnd = 0;
+
+  while (nameEnd < raw.length) {
+    const code = raw.charCodeAt(nameEnd);
+    if (isXmlSpace(code) || code === 0x2f) break;
+    nameEnd += 1;
+  }
+
+  let contentEnd = raw.length;
+
+  while (contentEnd > 0 && isXmlSpace(raw.charCodeAt(contentEnd - 1))) {
+    contentEnd -= 1;
+  }
+
+  return {
+    name: raw.slice(0, nameEnd),
+    selfClosing: contentEnd > 0 && raw.charCodeAt(contentEnd - 1) === 0x2f,
+  };
+}
+
+function extractParagraphs(xml) {
   const paragraphs = [];
-  const paragraphPattern =
-    /<w:p(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*?)?\/>/g;
+  const openParagraphs = [];
+  let tokenCount = 0;
+  let position = 0;
+
+  while (position < xml.length) {
+    const tagStart = xml.indexOf('<', position);
+
+    if (tagStart === -1) break;
+    position = tagStart;
+
+    if (xml.startsWith('<!--', position)) {
+      const end = xml.indexOf('-->', position + 4);
+      if (end === -1) fail('Invalid DOCX: unclosed XML comment');
+      position = end + 3;
+      continue;
+    }
+
+    if (xml.startsWith('<![CDATA[', position)) {
+      const end = xml.indexOf(']]>', position + 9);
+      if (end === -1) fail('Invalid DOCX: unclosed XML CDATA section');
+      position = end + 3;
+      continue;
+    }
+
+    if (xml.startsWith('<?', position)) {
+      const end = xml.indexOf('?>', position + 2);
+      if (end === -1) fail('Invalid DOCX: unclosed XML processing instruction');
+      position = end + 2;
+      continue;
+    }
+
+    if (xml.startsWith('<!', position)) {
+      const end = findTagEnd(xml, position + 2);
+      if (end === -1) fail('Invalid DOCX: unclosed XML declaration');
+      position = end + 1;
+      continue;
+    }
+
+    if (xml.charCodeAt(position + 1) === 0x2f) {
+      const end = findTagEnd(xml, position + 2);
+      if (end === -1) fail('Invalid DOCX: unclosed XML end tag');
+
+      const { name } = parseTag(xml.slice(position + 2, end));
+      position = end + 1;
+
+      if (name === 'w:p') {
+        if (openParagraphs.length === 0) {
+          fail('Invalid DOCX: mismatched paragraph tags');
+        }
+
+        const parts = openParagraphs.pop();
+        paragraphs.push(parts.join(''));
+      } else if (name === 'w:t') {
+        fail('Invalid DOCX: mismatched text tags');
+      }
+
+      continue;
+    }
+
+    const end = findTagEnd(xml, position + 1);
+    if (end === -1) fail('Invalid DOCX: unclosed XML tag');
+
+    const { name, selfClosing } = parseTag(xml.slice(position + 1, end));
+    position = end + 1;
+
+    if (name.length === 0) {
+      fail('Invalid DOCX: malformed XML tag');
+    }
+
+    if (name === 'w:t') {
+      tokenCount += 1;
+      if (tokenCount > MAX_TEXT_TOKENS) {
+        fail('Invalid DOCX: too many text tokens');
+      }
+
+      if (selfClosing) continue;
 
-  let match;
+      const closeStart = xml.indexOf('</w:t>', position);
+      if (closeStart === -1) fail('Invalid DOCX: unclosed text element');
+
+      const content = xml.slice(position, closeStart);
+      if (content.includes('<')) {
+        fail('Invalid DOCX: malformed text element');
+      }
+
+      if (content.length > 0 && openParagraphs.length > 0) {
+        openParagraphs[openParagraphs.length - 1].push(
+          decodeXmlEntities(content),
+        );
+      }
+
+      position = closeStart + 6;
+      continue;
+    }
+
+    if (name === 'w:p') {
+      if (paragraphs.length + openParagraphs.length >= MAX_PARAGRAPHS) {
+        fail('Invalid DOCX: too many paragraphs');
+      }
 
-  while ((match = paragraphPattern.exec(xml)) !== null) {
-    paragraphs.push(parseParagraph(match[1] ?? ''));
+      if (selfClosing) {
+        paragraphs.push('');
+      } else {
+        openParagraphs.push([]);
+      }
+
+      continue;
+    }
+
+    if (name === 'w:tab' || name === 'w:br' || name === 'w:cr') {
+      tokenCount += 1;
+      if (tokenCount > MAX_TEXT_TOKENS) {
+        fail('Invalid DOCX: too many text tokens');
+      }
+
+      if (openParagraphs.length > 0) {
+        openParagraphs[openParagraphs.length - 1].push(
+          name === 'w:tab' ? '\t' : '\n',
+        );
+      }
+    }
+  }
+
+  if (openParagraphs.length > 0) {
+    fail('Invalid DOCX: unclosed paragraph element');
   }
 
   return paragraphs;
 }
+
+export function extractDocx(buffer) {
+  const xml = readZipEntry(buffer, 'word/document.xml');
+  return extractParagraphs(xml);
+}

--- server.mjs ---
--- tasks/text-annotator/stage/server.mjs	2026-10-23 16:12:04.659674100 -0700
+++ tasks/text-annotator/stage2/server.mjs	2026-10-23 16:26:15.034995400 -0700
@@ -139,6 +139,11 @@
   });
 }
 
+function discardRequestBody(req) {
+  req.on('error', () => {});
+  req.resume();
+}
+
 async function readJsonBody(req) {
   const body = await readBody(req, JSON_BODY_LIMIT);
 
@@ -170,6 +175,35 @@
   return 0;
 }
 
+function validateAnnotationMetadata(annotations) {
+  for (let i = 0; i < annotations.length; i += 1) {
+    const annotation = annotations[i];
+
+    if (
+      annotation === null ||
+      typeof annotation !== 'object' ||
+      Array.isArray(annotation)
+    ) {
+      continue;
+    }
+
+    if (annotation.id !== undefined && typeof annotation.id !== 'string') {
+      return `annotations[${i}].id must be a string`;
+    }
+
+    if (annotation.createdAt !== undefined) {
+      if (
+        typeof annotation.createdAt !== 'string' ||
+        Number.isNaN(Date.parse(annotation.createdAt))
+      ) {
+        return `annotations[${i}].createdAt must be a valid timestamp`;
+      }
+    }
+  }
+
+  return null;
+}
+
 function prepareAnnotations(rawAnnotations, text) {
   const now = new Date().toISOString();
 
@@ -272,8 +306,16 @@
 }
 
 async function handlePutAnnotations(req, res, id, store) {
+  let document;
+
+  try {
+    document = await store.getDocument(id);
+  } catch (error) {
+    discardRequestBody(req);
+    throw error;
+  }
+
   const body = await readJsonBody(req);
-  const document = await store.getDocument(id);
 
   if (
     !body ||
@@ -290,6 +332,13 @@
     return;
   }
 
+  const metadataError = validateAnnotationMetadata(body.annotations);
+
+  if (metadataError !== null) {
+    sendError(res, 422, 'INVALID_ANNOTATIONS', metadataError);
+    return;
+  }
+
   const prepared = prepareAnnotations(body.annotations, document.text);
   const errors = validateAnnotations(prepared, document.text);
 
