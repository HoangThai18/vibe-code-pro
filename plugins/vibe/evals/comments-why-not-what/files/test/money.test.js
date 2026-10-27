import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertVnd } from '../src/billing/money.js';

test('rejects fractional đồng', () => {
  assert.throws(() => assertVnd(10.5), RangeError);
});
