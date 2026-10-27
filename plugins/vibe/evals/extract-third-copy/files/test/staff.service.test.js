import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb } from '../src/shared/db.js';
import { staffService } from '../src/modules/staff/index.js';

beforeEach(() => resetDb());

test('staff phone is stored normalized', () => {
  const row = staffService.create({ fullName: 'Nguyễn Thị Hoa', phone: '+84 912 345 678' });
  assert.equal(row.phone, '0912345678');
});

test('staff with an invalid phone is rejected', () => {
  assert.throws(() => staffService.create({ fullName: 'Hoa', phone: '12345' }), { code: 'validation_failed' });
});
