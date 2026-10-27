import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenant, listWorkspaces, withMember, withTenant } from '../src/db/tenant';
import { NotFoundError } from '../src/shared/errors';
import { adminUrl, errorCode, newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const app = newAppPool();
afterAll(async () => { await Promise.all([admin.end(), app.end()]); });

const ci = (name: string) => readFileSync(`sql/ci/${name}.sql`, 'utf8');
const user = async (email: string) =>
  (await app.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email])).rows[0]!.id;
const addMember = (tenantId: string, userId: string, role: string) =>
  withTenant(app, tenantId, (db) => db.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)', [tenantId, userId, role]));
const addCustomer = (tenantId: string, fullName: string, phone: string) =>
  withTenant(app, tenantId, async (db) =>
    (await db.query<{ id: string }>('INSERT INTO customers (full_name, phone) VALUES ($1, $2) RETURNING id', [fullName, phone])).rows[0]!.id);

let ownerA = '', ownerB = '', A = '', B = '';
beforeEach(async () => {
  await reset(admin);
  ownerA = await user('owner-a@example.com');
  ownerB = await user('owner-b@example.com');
  A = await createTenant(app, ownerA, 'Spa A');
  B = await createTenant(app, ownerB, 'Spa B');
});

describe('roles and CI checks (postgres-rls.md sections 1, 8)', () => {
  it('the app role bypasses nothing; no tenant table lacks RLS or a policy; append-only tables are protected', async () => {
    expect((await admin.query(ci('3-app-role'))).rows).toEqual([{ rolname: 'app_user', rolsuper: false, rolbypassrls: false }]);
    expect((await admin.query(ci('1-missing-rls'))).rows).toEqual([]);
    expect((await admin.query(ci('2-no-policy'))).rows).toEqual([]);
    expect((await admin.query(ci('4-append-only'))).rows).toEqual([]);
  });

  it('the append-only check catches a forgotten REVOKE', async () => {
    await admin.query('GRANT UPDATE ON audit_log TO app_user; GRANT INSERT ON tenant_domains TO app_user');
    try {
      expect((await admin.query(ci('4-append-only'))).rows).toEqual([
        { name: 'audit_log', kind: 'append-only', priv: 'UPDATE' },
        { name: 'tenant_domains', kind: 'read-only', priv: 'INSERT' },
      ]);
    } finally {
      await admin.query('REVOKE UPDATE ON audit_log FROM app_user; REVOKE INSERT ON tenant_domains FROM app_user');
    }
  });

  it('app_user can insert audit rows but never change or delete them; tenant_domains is read-only', async () => {
    await withTenant(app, A, (db) => db.query(
      "INSERT INTO audit_log (actor_type, actor_id, action, entity) VALUES ('user', $1, 'customer.write', 'customer')", [ownerA]));
    for (const sql of ["UPDATE audit_log SET action = 'x'", 'DELETE FROM audit_log', 'TRUNCATE audit_log']) {
      await expect(withTenant(app, A, (db) => db.query(sql)).catch(errorCode)).resolves.toBe('42501');
    }
    await admin.query("INSERT INTO tenant_domains (slug, tenant_id) VALUES ('spa-a', $1)", [A]);
    expect((await app.query('SELECT tenant_id FROM tenant_domains WHERE slug = $1', ['spa-a'])).rows).toEqual([{ tenant_id: A }]);
    await expect(app.query("UPDATE tenant_domains SET tenant_id = $1 WHERE slug = 'spa-a'", [B]).catch(errorCode)).resolves.toBe('42501');
    await expect(app.query("INSERT INTO tenant_domains VALUES ('spa-b', $1)", [B]).catch(errorCode)).resolves.toBe('42501');
  });

  it('a backfill as the owner without tenant context updates 0 rows on a FORCE table, with no error', async () => {
    await addCustomer(A, 'Lan', '0912345678');
    const res = await admin.query("SET ROLE app_owner; UPDATE customers SET email = 'x@example.com'; RESET ROLE") as unknown as { rowCount: number }[];
    expect(res[1]!.rowCount).toBe(0);
  });
});

describe('app_tenant_ids() for workers (postgres-rls.md section 3)', () => {
  it('a plain SELECT on tenants sees 0 rows without context; app_tenant_ids() lists active tenants only', async () => {
    const C = await createTenant(app, ownerA, 'Spa C');
    await admin.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [C]);
    expect((await app.query('SELECT id FROM tenants')).rowCount).toBe(0);
    const { rows } = await app.query<{ id: string }>('SELECT id FROM app_tenant_ids() AS id');
    expect(rows.map((r) => r.id).sort()).toEqual([A, B].sort());
  });

  it('is owned by a NOLOGIN BYPASSRLS role, and roles without the grant cannot run it', async () => {
    const { rows } = await admin.query(
      `SELECT r.rolname, r.rolcanlogin, r.rolbypassrls, p.prosecdef FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = 'app_tenant_ids'`);
    expect(rows).toEqual([{ rolname: 'app_definer', rolcanlogin: false, rolbypassrls: true, prosecdef: true }]);
    const client = await admin.connect();
    try {
      await client.query('SET ROLE authenticated');   // any role other than app_user
      await expect(client.query('SELECT * FROM app_tenant_ids()').catch(errorCode)).resolves.toBe('42501');
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });
});

describe('membership check (postgres-rls.md section 4)', () => {
  it('a member of B gets 404 on A even when app.user_id leaked onto the connection', async () => {
    const leaky = newAppPool(`-c app.user_id=${ownerB}`);   // e.g. a session-level SET from a login flow
    try {
      // Why the predicate matters: membership_read's OR branch returns B's row on A's path
      const raw = await withTenant(leaky, A, (db) => db.query('SELECT tenant_id FROM memberships WHERE user_id = $1', [ownerB]));
      expect(raw.rows).toEqual([{ tenant_id: B }]);
      await expect(withMember(leaky, A, ownerB, async () => 'in')).rejects.toBeInstanceOf(NotFoundError);
      await expect(withMember(leaky, B, ownerB, async (_db, actor) => actor.role)).resolves.toBe('owner');   // control
    } finally {
      await leaky.end();
    }
  });

  it('a malformed tenant id is a 404, not a database error', async () => {
    await expect(withMember(app, 'not-a-uuid', ownerA, async () => 'in')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('role-gated policy: managers read health notes, staff and jobs do not', async () => {
    const staff = await user('staff@example.com');
    const manager = await user('manager@example.com');
    await addMember(A, staff, 'staff');
    await addMember(A, manager, 'manager');
    const customer = await addCustomer(A, 'Lan', '0912345678');
    await withMember(app, A, manager, (db) =>
      db.query("INSERT INTO customer_health_notes (customer_id, note) VALUES ($1, 'Dị ứng tinh dầu')", [customer]));
    const read = (userId: string) => withMember(app, A, userId, async (db) => (await db.query('SELECT note FROM customer_health_notes')).rowCount);
    expect(await read(manager)).toBe(1);
    expect(await read(staff)).toBe(0);
    expect((await withTenant(app, A, (db) => db.query('SELECT note FROM customer_health_notes'))).rowCount).toBe(0);
    await expect(withMember(app, A, staff, (db) =>
      db.query("INSERT INTO customer_health_notes (customer_id, note) VALUES ($1, 'x')", [customer])).catch(errorCode)).resolves.toBe('42501');
  });

  it('the workspace list shows the user\'s active tenants only', async () => {
    await addMember(B, ownerA, 'staff');
    expect((await listWorkspaces(app, ownerA)).map((w) => [w.name, w.role])).toEqual([['Spa A', 'owner'], ['Spa B', 'staff']]);
    await admin.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [B]);
    expect((await listWorkspaces(app, ownerA)).map((w) => w.name)).toEqual(['Spa A']);
  });
});

describe('tenant-owned tables (multi-tenant.md section 2, isolation-tests.md section 3)', () => {
  it('a composite FK rejects another tenant\'s customer', async () => {
    const bCustomer = await addCustomer(B, 'Minh', '0987654321');
    const code = await withTenant(app, A, (db) => db.query(
      `INSERT INTO appointments (customer_id, staff_user_id, starts_at, ends_at)
       VALUES ($1, $2, now(), now() + interval '1 hour')`, [bCustomer, ownerA])).catch(errorCode);
    expect(code).toBe('23503');
  });

  it('the psql isolation script: control true, zero rows twice, then a policy violation', async () => {
    await addCustomer(B, 'Minh', '0987654321');
    const run = spawnSync('psql', [adminUrl, '-X', '-A', '-t', '-q', '-v', `tenant_a=${A}`, '-v', `tenant_b=${B}`,
      '-f', 'sql/isolation-check.sql'],
      { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c role=app_user' } });
    expect(run.stdout.split('\n').filter((l) => /^(t|f|\d+)$/.test(l))).toEqual(['t', '0', '0']);
    expect(run.stderr).toMatch(/new row violates row-level security policy for table "customers"/);
  });
});

describe('Supabase policies (postgres-rls.md section 6), against a stub of auth.uid()', () => {
  const asUser = async <T>(sub: string, fn: (q: (sql: string, values?: unknown[]) => Promise<{ rows: T[] }>) => Promise<void>) => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub })]);
      await client.query('SET LOCAL ROLE authenticated');
      await fn(async (sql, values) => (await client.query(sql, values)) as unknown as { rows: T[] });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  it('single-tenant: each user reads and writes only their own rows', async () => {
    const [u1, u2] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    await admin.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [u1, u2]);
    await admin.query("INSERT INTO public.notes (user_id, body) VALUES ($1, 'của u1'), ($2, 'của u2')", [u1, u2]);
    await asUser<{ body: string }>(u1, async (q) => {
      expect((await q('SELECT body FROM public.notes')).rows).toEqual([{ body: 'của u1' }]);
      await q("INSERT INTO public.notes (body) VALUES ('mới')");                 // user_id defaults to auth.uid()
      await expect(q("INSERT INTO public.notes (user_id, body) VALUES ($1, 'giả')", [u2]).catch(errorCode)).resolves.toBe('42501');
    });
  });

  it('multi-tenant: members see their tenants\' customers only', async () => {
    await addCustomer(A, 'Lan', '0912345678');
    await addCustomer(B, 'Minh', '0987654321');
    await asUser<{ full_name: string }>(ownerA, async (q) => {
      expect((await q('SELECT full_name FROM public.customers')).rows).toEqual([{ full_name: 'Lan' }]);
    });
  });
});

it('psql is available for the isolation script', () => {
  expect(execFileSync('psql', ['--version'], { encoding: 'utf8' })).toMatch(/PostgreSQL/);
});
