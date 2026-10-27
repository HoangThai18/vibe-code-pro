// test/momo.test.ts: node --import tsx --test
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { MOMO_CREATE_KEYS, momoIpnValid, momoSignature, MOMO_IPN_KEYS } from '../src/payments/momo';

test('create signature matches the official sample', () => {
  const f = { accessKey: 'F8BBA842ECF85', amount: '300000', extraData: '', ipnUrl: 'https://api.example.vn/v1/webhooks/momo/t1',
    orderId: 'SPA1042', orderInfo: 'Đặt cọc lịch hẹn', partnerCode: 'MOMO', redirectUrl: 'https://spa.example.vn/r',
    requestId: 'SPA1042-1', requestType: 'captureWallet' };
  // rawSignature exactly as in momo-wallet/payment nodejs/MoMo.js
  const raw = 'accessKey=' + f.accessKey + '&amount=' + f.amount + '&extraData=' + f.extraData + '&ipnUrl=' + f.ipnUrl +
    '&orderId=' + f.orderId + '&orderInfo=' + f.orderInfo + '&partnerCode=' + f.partnerCode + '&redirectUrl=' +
    f.redirectUrl + '&requestId=' + f.requestId + '&requestType=' + f.requestType;
  assert.equal(momoSignature(f, MOMO_CREATE_KEYS, 'secret'), createHmac('sha256', 'secret').update(raw).digest('hex'));
});

test('IPN signature: valid as sent, invalid when the amount changes', () => {
  const body: Record<string, string | number> = { partnerCode: 'MOMO', orderId: 'SPA1042', requestId: 'SPA1042-1',
    amount: 300000, orderInfo: 'Đặt cọc lịch hẹn', orderType: 'momo_wallet', transId: 4088878653, resultCode: 0,
    message: 'Successful.', payType: 'qr', responseTime: 1761470100000, extraData: '' };
  body.signature = momoSignature({ ...body, accessKey: 'F8BBA842ECF85' }, MOMO_IPN_KEYS, 'secret');
  assert.ok(momoIpnValid(body, 'F8BBA842ECF85', 'secret'));
  assert.ok(!momoIpnValid({ ...body, amount: 3000 }, 'F8BBA842ECF85', 'secret'));
});
