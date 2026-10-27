import { withTenant } from '../db.js';

export default async function voucherRoutes(app) {
  app.post('/v1/t/:tenantId/vouchers', async (req, reply) => {
    const { code, amount, customerId } = req.body;
    const row = await withTenant(req.params.tenantId, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO vouchers (tenant_id, code, amount, customer_id)
         VALUES ($1, upper($2), $3, $4)
         RETURNING id, code, amount, customer_id`,
        [req.params.tenantId, code, amount, customerId ?? null],
      );
      return rows[0];
    });
    return reply.code(201).send({ data: row });
  });

  app.post('/v1/t/:tenantId/vouchers/:code/redeem', async (req, reply) => {
    const result = await withTenant(req.params.tenantId, async (db) => {
      const { rows } = await db.query('SELECT id, amount, redeemed_at FROM vouchers WHERE code = upper($1)', [
        req.params.code,
      ]);
      const voucher = rows[0];
      if (!voucher) return { status: 404, body: { error: { code: 'not_found' } } };
      if (voucher.redeemed_at) return { status: 409, body: { error: { code: 'voucher_already_redeemed' } } };
      await db.query('UPDATE vouchers SET redeemed_at = now() WHERE id = $1', [voucher.id]);
      return { status: 200, body: { data: { id: voucher.id, amount: voucher.amount } } };
    });
    return reply.code(result.status).send(result.body);
  });
}
