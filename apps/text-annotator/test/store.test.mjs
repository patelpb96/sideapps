import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../src/store.mjs';

const doc = {
  id: 'doc_0123456789ab',
  filename: 'sample.txt',
  ext: 'txt',
  text: 'Hello world.',
  paragraphs: [{ index: 0, text: 'Hello world.', start: 0, end: 12 }],
  warnings: [],
  createdAt: '2026-10-23T12:00:00.000Z',
  meta: { chars: 12, words: 2, paragraphs: 1 },
};

test('store saves, gets, lists and deletes a document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-store-'));
  try {
    const store = new Store(dir);
    await store.saveDocument(doc);

    const got = await store.getDocument(doc.id);
    assert.equal(got.text, doc.text);

    const list = await store.listDocuments();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, doc.id);
    assert.equal(list[0].chars, 12);
    assert.equal(list[0].annotations, 0);

    await store.deleteDocument(doc.id);
    await assert.rejects(
      () => store.getDocument(doc.id),
      (error) => error.code === 'NOT_FOUND',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('store saves and reads annotations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-store-'));
  try {
    const store = new Store(dir);
    await store.saveDocument(doc);
    const annotations = [{
      id: 'ann_0123456789ab',
      start: 0,
      end: 5,
      label: 'Person',
      text: 'Hello',
      createdAt: '2026-10-23T12:00:00.000Z',
    }];
    await store.saveAnnotations(doc.id, annotations);
    assert.deepEqual(await store.getAnnotations(doc.id), annotations);
    const list = await store.listDocuments();
    assert.equal(list[0].annotations, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('store rejects a traversal-shaped id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotator-store-'));
  try {
    const store = new Store(dir);
    await assert.rejects(
      () => store.getDocument('../secret'),
      (error) => error.code === 'NOT_FOUND',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
