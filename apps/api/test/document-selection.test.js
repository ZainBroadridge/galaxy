import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { appendPdfSelection, MAX_DOCUMENT_BYTES } from '../../web/src/issuer/document-selection.js';

const pdf = (name, patch = {}) => Object.freeze({ name, type: 'application/pdf', size: 1024, lastModified: 1, ...patch });
const first = pdf('first.pdf'); const second = pdf('second.pdf'); const third = pdf('third.pdf');

test('three separate file-picker batches accumulate in selection order', () => {
  const initial = Object.freeze([]);
  const one = appendPdfSelection(initial, [first]);
  const two = appendPdfSelection(one, [second]);
  const three = appendPdfSelection(two, [third]);
  assert.deepEqual(three, [first, second, third]);
  assert.deepEqual(one, [first]); assert.deepEqual(two, [first, second]); assert.deepEqual(initial, []);
});

test('two files followed by one and one batch of three are accepted', () => {
  assert.deepEqual(appendPdfSelection(appendPdfSelection([], [first, second]), [third]), [first, second, third]);
  assert.deepEqual(appendPdfSelection([], [first, second, third]), [first, second, third]);
});

test('duplicate picker entries do not consume another slot', () => {
  assert.deepEqual(appendPdfSelection([first, second], [pdf('first.pdf'), third]), [first, second, third]);
  assert.deepEqual(appendPdfSelection([], [first, first, second]), [first, second]);
});

test('an over-limit batch is rejected without dropping any previous selections', () => {
  const before = Object.freeze([first, second]);
  assert.throws(() => appendPdfSelection(before, [third, pdf('fourth.pdf')]), /at most 3/u);
  assert.deepEqual(before, [first, second]);
});

test('the management picker counts saved documents as well as pending selections', () => {
  assert.deepEqual(appendPdfSelection([], [first], 2), [first]);
  assert.throws(() => appendPdfSelection([first], [second], 2), /at most 3/u);
  assert.deepEqual(appendPdfSelection([first], [first], 2), [first]);
  assert.throws(() => appendPdfSelection([], [first], 3), /at most 3/u);
});

test('invalid or oversized PDFs fail atomically and never change the existing list', () => {
  const before = Object.freeze([first]);
  for (const bad of [pdf('photo.png', { type: 'image/png' }), pdf('empty.pdf', { size: 0 }),
    pdf('large.pdf', { size: MAX_DOCUMENT_BYTES + 1 })]) {
    assert.throws(() => appendPdfSelection(before, [second, bad]));
    assert.deepEqual(before, [first]);
  }
  assert.equal(appendPdfSelection([], [pdf('limit.pdf', { size: MAX_DOCUMENT_BYTES })]).length, 1);
});

test('a PDF extension works when the browser supplies no MIME type', () => {
  assert.equal(appendPdfSelection([], [pdf('report.PDF', { type: '' })]).length, 1);
});

test('cancel preserves files and removing then selecting the same file works', () => {
  assert.deepEqual(appendPdfSelection([first, second], []), [first, second]);
  assert.deepEqual(appendPdfSelection([second], [first]), [second, first]);
});

async function picker(name, end, savedCount = 0) {
  const source = await readFile(new URL('../../web/src/pages/OrganiserDashboard.jsx', import.meta.url), 'utf8');
  const text = source.slice(source.indexOf(`  function ${name}(`), source.indexOf(`  async function ${end}(`));
  const context = { documents: [], documentFiles: [], view: { data: { documents: Array(savedCount).fill({}) } },
    appendPdfSelection, error: null, feedback: null };
  context.setDocuments = (files) => { context.documents = files; };
  context.setDocumentFiles = (files) => { context.documentFiles = files; };
  context.setError = (error) => { context.error = error; };
  context.setDocumentFeedback = (feedback) => { context.feedback = feedback; };
  const handle = vm.runInNewContext(`${text}; ${name};`, context);
  const select = (files) => {
    const input = { files, value: 'browser-file-selection' };
    handle({ currentTarget: input });
    assert.equal(input.value, '', 'reset the native picker so the same removed file can be selected again');
  };
  return { context, select };
}

test('Create Event callback accumulates batches, resets input, and preserves selection on error/cancel', async () => {
  const { context, select } = await picker('chooseDocuments', 'submit');
  select([first]); select([second]); select([]); select([third]);
  assert.deepEqual(context.documents, [first, second, third]);
  select([pdf('fourth.pdf')]);
  assert.match(context.error.message, /at most 3/u); assert.equal(context.documents.length, 3);
});

test('Manage Event callback shares the same cumulative rule and saved-document limit', async () => {
  const { context, select } = await picker('chooseAdditionalDocuments', 'uploadDocuments', 1);
  select([first]); select([second]); select([]);
  assert.deepEqual(context.documentFiles, [first, second]);
  select([third]);
  assert.equal(context.feedback.tone, 'error'); assert.equal(context.documentFiles.length, 2);
});
