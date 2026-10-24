import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LABELS, validateAnnotations } from '../src/validate.mjs';

const text = 'Alice met Bob in Paris on 12 May 2026.';

const ann = (start, end, label = 'Person') => ({
  start,
  end,
  label,
  text: text.slice(start, end),
});

test('LABELS is the V1 label set', () => {
  assert.deepEqual(LABELS, ['Person', 'Organization', 'Location', 'Date', 'Amount', 'Other']);
});

test('valid annotations produce no errors', () => {
  assert.deepEqual(validateAnnotations([ann(0, 5), ann(10, 13), ann(21, 26, 'Location')], text), []);
});

test('unknown label is rejected', () => {
  const errors = validateAnnotations([ann(0, 5, 'Animal')], text);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /label/i);
});

test('out-of-bounds and inverted spans are rejected', () => {
  assert.equal(validateAnnotations([ann(0, text.length + 1)], text).length, 1);
  assert.equal(validateAnnotations([ann(5, 5)], text).length, 1);
  assert.equal(validateAnnotations([{ start: -1, end: 2, label: 'Person' }], text).length, 1);
});

test('text mismatch is rejected', () => {
  const bad = { ...ann(0, 5), text: 'Alice' };
  bad.text = 'Wrong';
  assert.equal(validateAnnotations([bad], text).length, 1);
});

test('overlapping spans are rejected even when unsorted', () => {
  const errors = validateAnnotations([ann(10, 13), ann(4, 11)], text);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /overlap/i);
});

test('touching spans are allowed', () => {
  assert.deepEqual(validateAnnotations([ann(0, 5), ann(5, 8)], text), []);
});

test('non-array input is rejected', () => {
  assert.equal(validateAnnotations({}, text).length, 1);
});
