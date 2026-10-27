// auth.md section 5: role changes by rank, and a tenant never loses its last owner
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { createTenant, withMember, withTenant } from '../src/db/tenant';
import { changeMemberRole } from '../src/members/change-role';
import type { Role } from '../src/shared/authz';
import { HttpError } from '../src/shared/errors';
import { createUser, login } from './helpers/factories';
import { newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const pool = newAppPool();
afterAll(async () => { await Promise.all([admin.end(), pool.end()]); });

let T = '';
const people: Record<string, { userId: string; email: string }> = {};
const change = (by: string, target: string, role: Role) =>
  withMember(pool, T, people[by]!.userId, (db, actor) => changeMemberRole(db, actor, people[target]!.userId, role))
    .then(() => 'ok', (e: unknown) => (e instanceof HttpError ? e.code : String(e)));
const roles = async () => Object.fromEntries((await admin.query<{ email: string; role: string }>(
  'SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1', [T])).rows
  .map((r) => [Object.keys(people).find((k) => people[k]!.email === r.email), r.role]));

beforeEach(async () => {
  await reset(admin);
  for (const name of ['o1', 'o2', 'm1', 's1']) people[name] = await createUser(name);
  T = await createTenant(pool, people.o1!.userId, 'Spa');
  await withTenant(pool, T, (db) => db.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'manager'), ($1, $4, 'staff')`,
    [T, people.o2!.userId, people.m1!.userId, people.s1!.userId]));
});

describe('changing roles', () => {
  it('needs a rank at least the target\'s current and new role', async () => {
    expect(await change('s1', 'm1', 'staff')).toBe('forbidden');      // staff lack member.role_change
    expect(await change('m1', 'o2', 'staff')).toBe('forbidden');      // manager cannot demote an owner
    expect(await change('m1', 's1', 'owner')).toBe('forbidden');      // nor promote to owner
    expect(await change('m1', 's1', 'manager')).toBe('ok');
    expect(await change('o1', 'o2', 'manager')).toBe('ok');
    expect(await roles()).toEqual({ o1: 'owner', o2: 'manager', m1: 'manager', s1: 'manager' });
  });

  it('the last owner cannot step down; the change is audited', async () => {
    expect(await change('o1', 'o2', 'staff')).toBe('ok');
    expect(await change('o1', 'o1', 'manager')).toBe('last_owner');
    const audit = await admin.query('SELECT actor_id, action, entity_id, diff FROM audit_log');
    expect(audit.rows).toEqual([{ actor_id: people.o1!.userId, action: 'member.role_change', entity_id: people.o2!.userId,
      diff: { before: 'owner', after: 'staff' } }]);
  });

  it('two owners demoting each other at the same moment leave one owner', async () => {
    for (let i = 0; i < 10; i++) {
      await admin.query("UPDATE memberships SET role = 'owner' WHERE tenant_id = $1 AND user_id = ANY($2)", [T, [people.o1!.userId, people.o2!.userId]]);
      const results = await Promise.all([change('o1', 'o2', 'staff'), change('o2', 'o1', 'staff')]);
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      const r = await roles();
      expect([r.o1, r.o2].filter((x) => x === 'owner')).toHaveLength(1);
    }
  });

  it('over HTTP: PUT members/:userId/role', async () => {
    const { accessToken } = await login(people.m1!.email);
    const res = await request(app).put(`/v1/t/${T}/members/${people.o1!.userId}/role`)
      .set('Authorization', `Bearer ${accessToken}`).send({ role: 'staff' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});
