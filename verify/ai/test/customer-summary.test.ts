// test/customer-summary.test.ts — real PostgreSQL (FORCE RLS, app role), fake model API
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NotFoundError } from '../src/shared/errors';
import { customerSummary } from '../src/routes/customer-summary';
import { A, B, USER_A, admin, app, closeDb, resetDb } from './helpers/db';
import { fakeAnthropic, messageJson } from './helpers/fake-anthropic';

const CUSTOMER_A = 'c0000000-0000-0000-0000-00000000000a';
const CUSTOMER_B = 'c0000000-0000-0000-0000-00000000000b';

before(async () => {
  await resetDb();
  await admin.query(`INSERT INTO customers (tenant_id, id, full_name, phone) VALUES ($1, $2, 'Lan', '0912345678'), ($3, $4, 'Mai', '0987654321')`,
    [A, CUSTOMER_A, B, CUSTOMER_B]);
  await admin.query(`INSERT INTO customer_notes (tenant_id, customer_id, body) VALUES ($1, $2, 'Thích trà gừng sau khi massage.'),
                     ($3, $4, 'Dị ứng phấn hoa, đang mang thai.')`, [A, CUSTOMER_A, B, CUSTOMER_B]);
});
after(closeDb);

test('summary for spa A sends the model only A notes; B ids give 404 and no model call', async () => {
  const { client, requests } = fakeAnthropic([messageJson(JSON.stringify({ summary: 'Thích trà gừng.', followUps: [] }))]);
  const deps = { pool: app, client };

  await customerSummary(deps, { userId: USER_A }, { tenantId: A, customerId: CUSTOMER_A });
  const sent = JSON.stringify(requests[0]!.body);
  assert.match(sent, /trà gừng/);
  assert.doesNotMatch(sent, /phấn hoa|mang thai|0987654321/);        // nothing of spa B reaches the model

  // B's customer through A's path, and A's user in B's path: both look missing
  await assert.rejects(customerSummary(deps, { userId: USER_A }, { tenantId: A, customerId: CUSTOMER_B }), NotFoundError);
  await assert.rejects(customerSummary(deps, { userId: USER_A }, { tenantId: B, customerId: CUSTOMER_B }), NotFoundError);
  assert.equal(requests.length, 1);

  const { rows } = await admin.query('SELECT tenant_id, user_id FROM ai_usage');
  assert.deepEqual(rows, [{ tenant_id: A, user_id: USER_A }]);        // usage recorded under A, through RLS
});
