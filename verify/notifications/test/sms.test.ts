// test/sms.test.ts: node --import tsx --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smsParts } from '../src/notify/sms';

test('diacritics switch SMS to UCS-2 and multiply the parts billed', () => {
  const plain = 'Spa Hoa Sen nhac lich hen 10:30 ngay 27/10 voi KTV Lan. Doi hoac huy lich: goi 0281234567.';
  const viet = 'Spa Hoa Sen nhắc lịch hẹn 10:30 ngày 27/10 với KTV Lan. Đổi hoặc huỷ lịch: gọi 0281234567.';
  assert.deepEqual(smsParts(plain), { encoding: 'GSM-7', parts: 1 });
  assert.deepEqual(smsParts(viet), { encoding: 'UCS-2', parts: 2 });
  assert.deepEqual(smsParts('a'.repeat(161)), { encoding: 'GSM-7', parts: 2 });
  assert.deepEqual(smsParts('a'.repeat(81)), { encoding: 'GSM-7', parts: 1 });
  assert.deepEqual(smsParts('{'.repeat(81)), { encoding: 'GSM-7', parts: 2 }); // { counts twice
});
