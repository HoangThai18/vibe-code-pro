// permissions.md: custom roles, per-module bitmask, data scope; tenant isolation, no escalation, owner kept, fresh grants
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenant, withTenant } from '../src/db/tenant';
import { loadRoleGrants, requireBits, requirePermission, withMemberPermissions, type Scope } from '../src/permissions/grants';
import { assignRole, createOwnerRole, createRole, saveRoleGrants } from '../src/permissions/edit-role';
import type { Action } from '../src/shared/authz';
import { HttpError } from '../src/shared/errors';
import { adminUrl, errorCode, newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const app = newAppPool();
const psql = (sql: string) => execFileSync('psql', [adminUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'SET ROLE app_owner', '-c', sql],
  { env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
// The fail-closed scope policies would hide customers from every other test file (they don't set a scope)
beforeAll(() => { psql(`\\i sql/data-scope.sql`); });
afterAll(async () => {
  psql('DROP POLICY data_scope ON customers; DROP POLICY data_scope ON appointments');
  await Promise.all([admin.end(), app.end()]);
});

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof HttpError ? e.code : errorCode(e) ?? String(e)));
const BITS = { view: 1, create: 2, update: 4, delete: 8, export: 16, approve: 32 };
const u: Record<string, string> = {};
let A = '', B = '', X = '', Y = '';
const roles: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof withMemberPermissions<T>>[3], tenant = A) => withMemberPermissions(app, tenant, u[who]!, fn);
const grants = (permissions: Action[], modules: Record<string, number>, scope: Scope) => ({ permissions, modules, scope });

beforeEach(async () => {
  await reset(admin);
  for (const name of ['owner', 'owner2', 'manager', 'lead', 'reception', 'tech', 'ownerB']) {
    u[name] = (await admin.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [`${name.toLowerCase()}@spa.vn`])).rows[0]!.id;
  }
  A = await createTenant(app, u.owner!, 'Spa A');
  B = await createTenant(app, u.ownerB!, 'Spa B');
  await withTenant(app, A, async (db) => {
    for (const m of ['owner2', 'manager', 'lead', 'reception', 'tech']) {
      await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'staff')", [A, u[m]]);
    }
    await createOwnerRole(db, u.owner!);
    [X, Y] = (await db.query<{ id: string }>("INSERT INTO branches (name) VALUES ('Quận 1'), ('Thủ Đức') RETURNING id")).rows.map((r) => r.id) as [string, string];
    await db.query('INSERT INTO member_branches (user_id, branch_id) VALUES ($1, $3), ($2, $3), ($4, $3), ($5, $6)',
      [u.reception, u.tech, X, u.lead, u.owner2, Y]);
  });
  await withTenant(app, B, async (db) => {
    await createOwnerRole(db, u.ownerB!);
    roles.b = (await db.query<{ id: string }>("INSERT INTO roles (name) VALUES ('Vai trò của B') RETURNING id")).rows[0]!.id;
  });
  // The owner builds A's roles through the same code users go through
  await as('owner', async (db, owner) => {
    const define = async (name: string, g: ReturnType<typeof grants>) => {
      const id = await createRole(db, owner, name);
      await saveRoleGrants(db, owner, id, g);
      return id;
    };
    roles.manager = await define('Quản lý', grants(['customer.read', 'customer.write', 'customer.import', 'appointment.write', 'member.role_change'],
      { customer: BITS.view | BITS.create | BITS.update, appointment: BITS.view | BITS.create | BITS.update, member: BITS.view | BITS.update }, 'tenant'));
    roles.lead = await define('Trưởng chi nhánh', grants(['customer.read', 'customer.write', 'member.role_change'],
      { customer: BITS.view | BITS.create | BITS.update }, 'branch'));
    roles.reception = await define('Lễ tân ca tối', grants(['customer.read', 'appointment.write'],
      { customer: BITS.view, appointment: BITS.view | BITS.create }, 'branch'));
    roles.tech = await define('Kỹ thuật viên', grants(['customer.read'], { appointment: BITS.view }, 'own'));
    roles.billing = await define('Kế toán', grants(['billing.manage'], { invoice: BITS.view | BITS.export }, 'tenant'));
    for (const [who, role] of [['manager', 'manager'], ['lead', 'lead'], ['reception', 'reception'], ['tech', 'tech']] as const) {
      await assignRole(db, owner, u[who]!, roles[role]!);
    }
  });
  await admin.query(`INSERT INTO customers (tenant_id, full_name, phone, branch_id) VALUES
    ($1, 'Khách Quận 1', '0911111111', $2), ($1, 'Khách Thủ Đức', '0922222222', $3), ($1, 'Khách chưa gán', '0933333333', NULL)`, [A, X, Y]);
});

describe('one resolver, one check', () => {
  it('named permissions and module bits come from the member\'s role, once per request', async () => {
    await as('manager', async (_db, actor) => {
      expect(actor.roleId).toBe(roles.manager);
      requirePermission(actor, 'customer.write');
      requireBits(actor, 'customer', 'update');
      expect(() => requireBits(actor, 'customer', 'delete')).toThrow(HttpError);
      expect(() => requirePermission(actor, 'billing.manage')).toThrow(HttpError);
    });
    await as('owner', async (_db, actor) => { requireBits(actor, 'invoice', 'approve'); requirePermission(actor, 'billing.manage'); });
  });

  it('the readable matrix shows the bits as columns; the catalogs are read-only and match the Action list', async () => {
    const { rows } = await withTenant(app, A, (db) => db.query(
      "SELECT can_view, can_create, can_update, can_delete FROM role_access_matrix WHERE role_id = $1 AND module = 'customer'", [roles.manager]));
    expect(rows).toEqual([{ can_view: true, can_create: true, can_update: true, can_delete: false }]);
    await expect(code(app.query("INSERT INTO permissions VALUES ('billing.refund')"))).resolves.toBe('42501');
    await expect(code(app.query("INSERT INTO modules VALUES ('payroll')"))).resolves.toBe('42501');
    const { ACTIONS } = await import('../src/shared/authz');
    expect((await app.query<{ key: string }>('SELECT key FROM permissions ORDER BY key')).rows.map((r) => r.key)).toEqual([...ACTIONS].sort());
  });
});

describe('tenants never share roles', () => {
  it('A cannot see, load or assign B\'s role; the composite FK refuses it too', async () => {
    const names = await withTenant(app, A, async (db) => (await db.query<{ name: string }>('SELECT name FROM roles')).rows.map((r) => r.name));
    expect(names).not.toContain('Vai trò của B');
    expect(names).toContain('Quản lý');                                             // control
    expect(await withTenant(app, A, (db) => loadRoleGrants(db, roles.b!))).toBeNull();
    expect(await code(as('owner', (db, owner) => assignRole(db, owner, u.tech!, roles.b!)))).toBe('not_found');
    expect(await code(withTenant(app, A, (db) => db.query('UPDATE member_roles SET role_id = $2 WHERE user_id = $1', [u.tech, roles.b])))).toBe('23503');
  });
});

describe('no privilege escalation through role editing', () => {
  it('nobody grants a permission, a bit or a scope they don\'t hold', async () => {
    const edit = (who: string, role: string, g: ReturnType<typeof grants>) => code(as(who, (db, actor) => saveRoleGrants(db, actor, roles[role]!, g)));
    expect(await edit('manager', 'reception', grants(['customer.read', 'billing.manage'], { customer: BITS.view }, 'branch'))).toBe('forbidden');
    expect(await edit('manager', 'reception', grants(['customer.read'], { customer: BITS.view | BITS.delete }, 'branch'))).toBe('forbidden');
    expect(await edit('lead', 'reception', grants(['customer.read'], { customer: BITS.view }, 'tenant'))).toBe('forbidden');
    expect(await edit('manager', 'billing', grants([], {}, 'tenant'))).toBe('forbidden');   // nor edit a role above them
    expect(await edit('manager', 'reception', grants(['customer.read', 'customer.write'], { customer: BITS.view | BITS.update }, 'branch'))).toBe('ok');
  });

  it('assigning a role needs its grants and the member\'s current ones; only owners hand out the owner role', async () => {
    const ownerRole = (await withTenant(app, A, (db) => db.query<{ id: string }>('SELECT id FROM roles WHERE is_owner'))).rows[0]!.id;
    const assign = (who: string, target: string, role: string) => code(as(who, (db, actor) => assignRole(db, actor, u[target]!, role)));
    expect(await assign('manager', 'manager', ownerRole)).toBe('forbidden');
    expect(await assign('manager', 'manager', roles.billing!)).toBe('forbidden');
    expect(await assign('manager', 'owner', roles.reception!)).toBe('forbidden');      // can't demote the owner
    expect(await assign('reception', 'tech', roles.reception!)).toBe('forbidden');     // lacks member.role_change
    expect(await assign('manager', 'tech', roles.reception!)).toBe('ok');
  });
});

describe('the owner role and the last owner', () => {
  it('the owner role cannot be edited, in code or in SQL', async () => {
    const ownerRole = (await withTenant(app, A, (db) => db.query<{ id: string }>('SELECT id FROM roles WHERE is_owner'))).rows[0]!.id;
    expect(await code(as('owner', (db, o) => saveRoleGrants(db, o, ownerRole, grants([], {}, 'own'))))).toBe('owner_role_locked');
    for (const sql of ["UPDATE roles SET data_scope = 'own' WHERE is_owner", 'DELETE FROM roles WHERE is_owner']) {
      expect(await code(withTenant(app, A, (db) => db.query(sql)))).toBe('P0001');
    }
  });

  it('the last owner keeps the role; with two owners, one may step down', async () => {
    expect(await code(as('owner', (db, o) => assignRole(db, o, u.owner!, roles.manager!)))).toBe('last_owner');
    const ownerRole = (await withTenant(app, A, (db) => db.query<{ id: string }>('SELECT id FROM roles WHERE is_owner'))).rows[0]!.id;
    await as('owner', (db, o) => assignRole(db, o, u.owner2!, ownerRole));
    expect(await code(as('owner', (db, o) => assignRole(db, o, u.owner!, roles.manager!)))).toBe('ok');
  });

  it('two owners demoting each other at the same moment leave one owner', async () => {
    const ownerRole = (await withTenant(app, A, (db) => db.query<{ id: string }>('SELECT id FROM roles WHERE is_owner'))).rows[0]!.id;
    for (let i = 0; i < 10; i++) {
      await admin.query('UPDATE member_roles SET role_id = $2 WHERE tenant_id = $3 AND user_id = ANY($1)', [[u.owner, u.owner2], ownerRole, A]);
      const results = await Promise.all([
        code(as('owner', (db, o) => assignRole(db, o, u.owner2!, roles.manager!))),
        code(as('owner2', (db, o) => assignRole(db, o, u.owner!, roles.manager!))),
      ]);
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      const { rows } = await admin.query('SELECT count(*)::int AS n FROM member_roles WHERE tenant_id = $1 AND role_id = $2', [A, ownerRole]);
      expect(rows[0].n).toBe(1);
    }
  });
});

it('a role edit applies to the next request', async () => {
  const read = () => code(as('reception', async (db, actor) => {
    requirePermission(actor, 'customer.read');
    return db.query('SELECT 1 FROM customers');
  }));
  expect(await read()).toBe('ok');
  await as('owner', (db, o) => saveRoleGrants(db, o, roles.reception!, grants(['appointment.write'], { appointment: BITS.view }, 'branch')));
  expect(await read()).toBe('forbidden');
});

describe('data scope in RLS (data-scope.sql)', () => {
  const names = (who: string) => as(who, async (db) => (await db.query<{ full_name: string }>('SELECT full_name FROM customers')).rows.map((r) => r.full_name));

  it('branch scope: Quận 1 staff see Quận 1 customers only, and cannot add one to another branch', async () => {
    expect(await names('reception')).toEqual(['Khách Quận 1']);
    expect((await names('manager')).sort()).toEqual(['Khách chưa gán', 'Khách Quận 1', 'Khách Thủ Đức'].sort());   // tenant scope
    expect(await code(as('lead', (db) => db.query(
      "INSERT INTO customers (full_name, phone, branch_id) VALUES ('Lậu', '0944444444', $1)", [Y])))).toBe('42501');
    expect(await code(as('lead', (db) => db.query(
      "INSERT INTO customers (full_name, phone, branch_id) VALUES ('Mới', '0944444444', $1)", [X])))).toBe('ok');
  });

  it('no scope set (a job that forgot it) sees nothing; a job sets tenant scope explicitly', async () => {
    expect((await withTenant(app, A, (db) => db.query('SELECT 1 FROM customers'))).rowCount).toBe(0);
    const all = await withTenant(app, A, async (db) => {
      await db.query("SELECT set_config('app.data_scope', 'tenant', true)");
      return (await db.query('SELECT 1 FROM customers')).rowCount;
    });
    expect(all).toBe(3);
  });

  it('own scope: a technician sees only their own appointments', async () => {
    const customer = (await admin.query<{ id: string }>("SELECT id FROM customers WHERE branch_id = $1", [X])).rows[0]!.id;
    await admin.query(`INSERT INTO appointments (tenant_id, customer_id, staff_user_id, starts_at, ends_at, branch_id) VALUES
      ($1, $2, $3, '2026-11-02T03:00Z', '2026-11-02T04:00Z', $5), ($1, $2, $4, '2026-11-02T03:00Z', '2026-11-02T04:00Z', $5)`,
      [A, customer, u.tech, u.reception, X]);
    const staff = (who: string) => as(who, async (db) => (await db.query<{ staff_user_id: string }>('SELECT staff_user_id FROM appointments')).rows.map((r) => r.staff_user_id));
    expect(await staff('tech')).toEqual([u.tech]);
    expect((await staff('reception')).sort()).toEqual([u.tech, u.reception].sort());   // branch scope: both, same branch
  });
});
