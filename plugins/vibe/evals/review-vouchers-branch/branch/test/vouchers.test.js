import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, seedTwoTenants } from './helpers.js';

test('creates and redeems a voucher', async () => {
  const app = await buildApp();
  const { tenantA } = await seedTwoTenants();
  const created = await app.inject({
    method: 'POST',
    url: `/v1/t/${tenantA}/vouchers`,
    payload: { code: 'tet2027', amount: 500000 },
  });
  assert.equal(created.statusCode, 201);
  const redeemed = await app.inject({ method: 'POST', url: `/v1/t/${tenantA}/vouchers/TET2027/redeem` });
  assert.equal(redeemed.statusCode, 200);
  const again = await app.inject({ method: 'POST', url: `/v1/t/${tenantA}/vouchers/TET2027/redeem` });
  assert.equal(again.statusCode, 409);
});
