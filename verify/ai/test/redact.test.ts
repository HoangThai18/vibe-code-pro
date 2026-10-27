// test/redact.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactContacts } from '../src/ai/redact';

test('redacts every phone format staff type, and emails', () => {
  for (const phone of ['0912 345 678', '0912.345.678', '+84912345678', '84912345678', '(+84) 912-345-678',
    '0084 912 345 678', '028 3823 4567', '(028) 3823 4567', '+84 28 3823 4567']) {
    assert.equal(redactContacts(`Gọi ${phone} nhé`), 'Gọi [số điện thoại] nhé', phone);
  }
  assert.equal(redactContacts('mail lan.nguyen@spa.vn'), 'mail [email]');
});

test('keeps amounts, order codes, dates and times', () => {
  const text = 'Gói 1.500.000đ, nợ 15.000.000.000đ, mã đơn 2026100512, ngày 2026-10-05 lúc 14:30';
  assert.equal(redactContacts(text), text);
});
