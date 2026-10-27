import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStore } from '../src/shared/store.js';
import { customerService } from '../src/customers/customer.service.js';

const SPA_A = 'tenant-a';

beforeEach(() => resetStore());

test('create stores the phone normalized', () => {
  const c = customerService.create(SPA_A, { fullName: 'Nguyễn Thị Hoa', phone: '+84 912 345 678' });
  assert.equal(c.phone, '0912345678');
});

test('create rejects an invalid phone', () => {
  assert.throws(() => customerService.create(SPA_A, { fullName: 'Hoa', phone: '12345' }), { code: 'validation_failed' });
});
