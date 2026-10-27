import Fastify from 'fastify';
import pg from 'pg';
import appointmentRoutes from '../src/routes/appointments.js';

export async function buildApp() {
  const app = Fastify();
  await app.register(appointmentRoutes);
  return app;
}

// Seeds as the owner role (OWNER_DATABASE_URL), two tenants with one customer and one appointment each.
export async function seedTwoTenants() {
  const owner = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
  await owner.connect();
  try {
    await owner.query('TRUNCATE tenants CASCADE');
    const ids = {};
    for (const t of ['A', 'B']) {
      const { rows: [tenant] } = await owner.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`Spa ${t}`]);
      await owner.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenant.id]);
      const { rows: [customer] } = await owner.query(
        'INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, $2, $3) RETURNING id',
        [tenant.id, `Khách ${t}`, t === 'A' ? '0912345678' : '0987654321'],
      );
      const { rows: [appt] } = await owner.query(
        `INSERT INTO appointments (tenant_id, customer_id, starts_at, ends_at)
         VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 1 hour') RETURNING id`,
        [tenant.id, customer.id],
      );
      ids[`tenant${t}`] = tenant.id;
      ids[`customer${t}`] = customer.id;
      ids[`appointment${t}`] = appt.id;
    }
    return ids;
  } finally {
    await owner.end();
  }
}
