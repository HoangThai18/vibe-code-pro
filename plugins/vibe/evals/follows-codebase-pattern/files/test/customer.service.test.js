import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb } from '../src/shared/db.js';
import { customerService } from '../src/modules/customers/index.js';

beforeEach(() => resetDb());

test('tạo khách và liệt kê', () => {
  customerService.create({ email: 'An@X.com ', name: 'An' });
  assert.equal(customerService.list().length, 1);
  assert.equal(customerService.list()[0].email, 'an@x.com');
});

test('email trùng báo customer_email_taken', () => {
  customerService.create({ email: 'an@x.com', name: 'An' });
  assert.throws(() => customerService.create({ email: 'AN@x.com', name: 'An 2' }), { code: 'customer_email_taken' });
});
