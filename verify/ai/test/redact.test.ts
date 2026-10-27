// test/redact.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactContacts } from '../src/ai/redact';

test('che số điện thoại và email, giữ số tiền và mã đơn', () => {
  assert.equal(
    redactContacts('Gọi 0912 345 678 hoặc +84912345678, 0912.345.678, mail lan.nguyen@spa.vn'),
    'Gọi [số điện thoại] hoặc [số điện thoại], [số điện thoại], mail [email]',
  );
  assert.equal(redactContacts('Gói 1.500.000đ, mã đơn 2026100512'), 'Gói 1.500.000đ, mã đơn 2026100512');
});
