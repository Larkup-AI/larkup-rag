import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundTabularRows,
  DEFAULT_TABULAR_RESULT_LIMIT,
  MAX_TABULAR_RESULT_LIMIT,
} from './tabular-store';

test('bounds raw tabular result pages without changing the total result count', () => {
  const rows = Array.from({ length: 800 }, (_, id) => ({ id }));

  const defaultPage = boundTabularRows(rows);
  assert.equal(defaultPage.rows.length, DEFAULT_TABULAR_RESULT_LIMIT);
  assert.equal(defaultPage.totalRows, 800);
  assert.equal(defaultPage.truncated, true);

  const requestedPage = boundTabularRows(rows, 1_000);
  assert.equal(requestedPage.rows.length, MAX_TABULAR_RESULT_LIMIT);
  assert.equal(requestedPage.totalRows, 800);
  assert.equal(requestedPage.truncated, true);
});

test('marks a complete small tabular result as untruncated', () => {
  const page = boundTabularRows([{ id: 1 }, { id: 2 }], 20);

  assert.equal(page.rows.length, 2);
  assert.equal(page.totalRows, 2);
  assert.equal(page.truncated, false);
});
