import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, seedTwoTenants } from './helpers.js';

test('a tenant cannot read another tenant appointment', async () => {
  const app = await buildApp();
  const { tenantA, appointmentB } = await seedTwoTenants();
  const res = await app.inject({ method: 'GET', url: `/v1/t/${tenantA}/appointments/${appointmentB}` });
  assert.equal(res.statusCode, 404);
});
