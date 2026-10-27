// apps/api/src/routes/customer-summary.ts — POST /v1/t/:tenantId/customers/:customerId/summary
import type Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { summarizeNotes, type CustomerNote } from '../ai/summarize-notes';
import { pgUsageStore } from '../ai/usage-pg';
import { withMember } from '../db/tenant';        // the vibe-backend skill, references/postgres-rls.md section 4
import { authorize } from '../shared/authz';       // same skill, references/auth.md section 4
import { NotFoundError } from '../shared/errors';

export async function customerSummary(
  deps: { pool: Pool; client: Anthropic },
  session: { userId: string },                    // from the verified session, never from the body
  params: { tenantId: string; customerId: string },
) {
  // Tenant from the path, membership and permission checked; FORCE RLS limits every query to that tenant
  const notes = await withMember(deps.pool, params.tenantId, session.userId, async (db, actor) => {
    authorize(actor, 'customer.read');
    const found = await db.query('SELECT 1 FROM customers WHERE id = $1', [params.customerId]);
    if (found.rowCount === 0) throw new NotFoundError();   // another tenant's customer looks like a missing one
    const { rows } = await db.query<CustomerNote>(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS "createdAt", body AS text
         FROM customer_notes WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [params.customerId],
    );
    return rows.reverse();
  });
  // The model call runs after the transaction: never hold a DB connection while waiting for the model
  const ctx = { tenantId: params.tenantId, userId: session.userId };
  return summarizeNotes({ client: deps.client, usage: pgUsageStore(deps.pool) }, ctx, notes);
}
