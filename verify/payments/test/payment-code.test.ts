// test/payment-code.test.ts: node --import tsx --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPaymentCode, isPaymentCode, newPaymentCode } from '../src/payments/payment-code';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

test('new codes are 9 Crockford characters with a valid check, and random', () => {
  const codes = new Set(Array.from({ length: 2000 }, newPaymentCode));
  assert.equal(codes.size, 2000);
  for (const c of codes) assert.ok(isPaymentCode(c), c);
});

test('every single wrong character and every swap of two neighbors fails the check', () => {
  for (let n = 0; n < 50; n++) {
    const code = newPaymentCode();
    for (let i = 0; i < 9; i++) {
      for (const ch of ALPHABET) {
        if (ch !== code[i]) assert.equal(isPaymentCode(code.slice(0, i) + ch + code.slice(i + 1)), false, `${code} ${i} ${ch}`);
      }
      if (i < 8 && code[i] !== code[i + 1]) {
        assert.equal(isPaymentCode(code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2)), false, `${code} swap ${i}`);
      }
    }
  }
});

test('found in a transfer note: whole word only, case and O/I/L forgiven', () => {
  assert.equal(findPaymentCode('NGUYEN THI THAO chuyen tien SPAK7M1Q0XA7'), 'K7M1Q0XA7');
  assert.equal(findPaymentCode('ck spa k7mlqoxa7 coc'), 'K7M1Q0XA7');
  assert.equal(findPaymentCode('MBVCB.123.SPAK7M1Q0XA7.CT'), 'K7M1Q0XA7');
  assert.equal(findPaymentCode('XSPAK7M1Q0XA7'), null);        // not a word on its own
  assert.equal(findPaymentCode('SPAK7M1Q0XA78'), null);        // longer than a code
  assert.equal(findPaymentCode('SPA1042'), null);              // an old sequential code
});
