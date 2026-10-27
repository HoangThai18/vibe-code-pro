import pg from 'pg';

export const adminUrl = process.env.DATABASE_URL!;
// The app connects as app_user. Its password differs between machines, so tests log in as the superuser
// and switch role at connect time: privileges and RLS are then app_user's.
export const APP_ROLE = '-c role=app_user';
export const newAdminPool = () => new pg.Pool({ connectionString: adminUrl, max: 4 });
export const newAppPool = (extra = '') => new pg.Pool({ connectionString: adminUrl, max: 10, options: `${APP_ROLE} ${extra}`.trim() });

// Wipes data between tests (as superuser); roles and schema stay
export async function reset(admin: pg.Pool) {
  await admin.query(`TRUNCATE tenants, users, memberships, customers, appointments, customer_health_notes, tenant_domains,
    audit_log, api_keys, refresh_tokens, user_identities, idempotency_keys, auth.users, public.notes CASCADE`);
}

export const errorCode = (err: unknown) => (err instanceof pg.DatabaseError ? err.code : undefined);
