import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb } from '../src/shared/db.js';
import { customerService } from '../src/modules/customers/index.js';

beforeEach(() => resetDb());

test('customer phone is stored normalized', () => {
  const row = customerService.create({ fullName: 'Nguyễn Thị Hoa', phone: '+84 912 345 678' });
  assert.equal(row.phone, '0912345678');
});

test('customer with an invalid phone is rejected', () => {
  assert.throws(() => customerService.create({ fullName: 'Hoa', phone: '12345' }), { code: 'validation_failed' });
});
