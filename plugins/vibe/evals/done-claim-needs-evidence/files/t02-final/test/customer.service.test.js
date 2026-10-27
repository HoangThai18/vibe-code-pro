import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStore } from '../src/shared/store.js';
import { customerService } from '../src/customers/customer.service.js';

const SPA_A = 'tenant-a';
const SPA_B = 'tenant-b';

beforeEach(() => resetStore());

test('create stores the phone normalized', () => {
  const c = customerService.create(SPA_A, { fullName: 'Nguyễn Thị Hoa', phone: '+84 912 345 678' });
  assert.equal(c.phone, '0912345678');
});

test('create rejects an invalid phone', () => {
  assert.throws(() => customerService.create(SPA_A, { fullName: 'Hoa', phone: '12345' }), { code: 'validation_failed' });
});

test('create rejects a phone already used in the same spa', () => {
  customerService.create(SPA_A, { fullName: 'Hoa', phone: '0912345678' });
  assert.throws(() => customerService.create(SPA_A, { fullName: 'Lan', phone: '+84912345678' }), {
    code: 'customer_phone_taken',
  });
});

test('another spa may use the same phone', () => {
  customerService.create(SPA_A, { fullName: 'Hoa', phone: '0912345678' });
  const c = customerService.create(SPA_B, { fullName: 'Hoa', phone: '0912345678' });
  assert.equal(c.phone, '0912345678');
});

test('update stores the phone normalized', () => {
  const c = customerService.create(SPA_A, { fullName: 'Nguyễn Thị Hoa', phone: '0912345678' });
  const updated = customerService.update(SPA_A, c.id, { phone: '0987.654.321' });
  assert.equal(updated.phone, '0987654321');
});
