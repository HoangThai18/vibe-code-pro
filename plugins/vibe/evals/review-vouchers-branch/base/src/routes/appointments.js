import { withTenant } from '../db.js';

export default async function appointmentRoutes(app) {
  app.get('/v1/t/:tenantId/appointments/:id', async (req, reply) => {
    const row = await withTenant(req.params.tenantId, async (db) => {
      const { rows } = await db.query(
        'SELECT id, customer_id, starts_at, ends_at, status FROM appointments WHERE id = $1',
        [req.params.id],
      );
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: { code: 'not_found' } });
    return { data: row };
  });
}
