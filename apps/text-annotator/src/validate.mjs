export const LABELS = [
  'Person',
  'Organization',
  'Location',
  'Date',
  'Amount',
  'Other',
];

export function validateAnnotations(annotations, text) {
  if (!Array.isArray(annotations)) {
    return ['annotations must be an array'];
  }

  const documentText = typeof text === 'string' ? text : '';
  const errorsByIndex = Array.from({ length: annotations.length }, () => []);
  const spans = [];

  for (let i = 0; i < annotations.length; i += 1) {
    const annotation = annotations[i];
    const where = `annotations[${i}]`;
    const errors = errorsByIndex[i];

    if (
      annotation === null ||
      typeof annotation !== 'object' ||
      Array.isArray(annotation)
    ) {
      errors.push(`${where} must be an object`);
      continue;
    }

    if (!Number.isInteger(annotation.start)) {
      errors.push(`${where}.start must be an integer`);
      continue;
    }

    if (annotation.start < 0) {
      errors.push(`${where}.start must be greater than or equal to 0`);
      continue;
    }

    if (!Number.isInteger(annotation.end)) {
      errors.push(`${where}.end must be an integer`);
      continue;
    }

    if (annotation.end <= annotation.start) {
      errors.push(`${where}.end must be greater than start`);
      continue;
    }

    if (annotation.end > documentText.length) {
      errors.push(`${where}.end must be less than or equal to the document text length`);
      continue;
    }

    if (!LABELS.includes(annotation.label)) {
      errors.push(`${where}.label must be one of ${LABELS.join(', ')}`);
    }

    if (annotation.text !== undefined) {
      const expected = documentText.slice(annotation.start, annotation.end);
      if (typeof annotation.text !== 'string' || annotation.text !== expected) {
        errors.push(
          `${where}.text does not match the document text for [${annotation.start}, ${annotation.end})`,
        );
      }
    }

    spans.push({
      start: annotation.start,
      end: annotation.end,
      index: i,
    });
  }

  const sortedSpans = spans
    .slice()
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.index - b.index,
    );

  let previousEnd = 0;
  let hasPrevious = false;

  for (const span of sortedSpans) {
    if (hasPrevious && span.start < previousEnd) {
      errorsByIndex[span.index].push(
        `annotations[${span.index}] overlaps a previous annotation`,
      );
    }

    if (!hasPrevious || span.end > previousEnd) {
      previousEnd = span.end;
    }
    hasPrevious = true;
  }

  return errorsByIndex.flat();
}
