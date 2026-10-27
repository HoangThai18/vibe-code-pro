// test/helpers.ts — the app's DML-only user runs the tests; the owner only for DDL and scratch databases
import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { ADMIN_URL, APP_URL, DB, OWNER_URL } from '../scripts/env';
import { createAppPool } from '../src/db/pool';
import { withMember } from '../src/db/tenant';
import { createCustomer } from '../src/customers';

export const app = createAppPool(APP_URL);
export const owner = createAppPool(OWNER_URL);
export { ADMIN_URL, APP_URL, DB, OWNER_URL };

export interface Tenant { tenantId: string; ownerId: string; managerId: string; staffId: string; staff2Id: string }

export async function seedTenant(name: string, status = 'active', tenantId = randomUUID()): Promise<Tenant> {
  const t = { tenantId, ownerId: randomUUID(), managerId: randomUUID(), staffId: randomUUID(), staff2Id: randomUUID() };
  await app.query('INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)', [t.tenantId, name, status]);
  const users = [t.ownerId, t.managerId, t.staffId, t.staff2Id];
  await app.query('INSERT INTO users (id, email) VALUES ?', [users.map((id) => [id, `${id}@example.vn`])]);
  await app.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ?',
    [[[t.tenantId, t.ownerId, 'owner'], [t.tenantId, t.managerId, 'manager'], [t.tenantId, t.staffId, 'staff'], [t.tenantId, t.staff2Id, 'staff']]]);
  return t;
}

export async function seedStaff(t: Tenant): Promise<string> {
  const id = randomUUID();
  await app.query('INSERT INTO users (id, email) VALUES (?, ?)', [id, `${id}@example.vn`]);
  await app.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, 'staff')", [t.tenantId, id]);
  return id;
}

export const asOwner = <T>(t: Tenant, fn: Parameters<typeof withMember<T>>[3]) => withMember(app, t.tenantId, t.ownerId, fn);

export async function seedCustomer(t: Tenant, fullName: string, phone: string) {
  return asOwner(t, (db, actor) => createCustomer(db, actor, { fullName, phone }));
}

export const connect = (uri: string, extra: mysql.ConnectionOptions = {}): Promise<Connection> =>
  mysql.createConnection({ uri, charset: 'utf8mb4_0900_ai_ci', timezone: 'Z', ...extra });

export async function one<T = RowDataPacket>(c: Connection | mysql.Pool, sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await c.query<RowDataPacket[]>(sql, params);
  return rows[0] as T;
}

// A scratch database for DDL experiments, dropped by the caller
export async function scratchDb(suffix: string): Promise<string> {
  const name = `${DB}_${suffix}`;
  const c = await connect(ADMIN_URL);
  await c.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await c.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await c.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.href;
}

export async function dropDb(uri: string) {
  const c = await connect(ADMIN_URL);
  await c.query(`DROP DATABASE IF EXISTS \`${new URL(uri).pathname.slice(1)}\``);
  await c.end();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const errnoOf = async (p: Promise<unknown>) => p.then(() => 0, (e: { errno?: number }) => e.errno ?? -1);

export async function endAll() {
  await Promise.all([app.end(), owner.end()]);
}
