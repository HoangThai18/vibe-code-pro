// Fresh schema for each DB test file: an empty database is enough (verify/tools/run.sh ai)
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://vibe_test:vibe@localhost:5432/verify_ai';
const sql = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

export const admin = new pg.Pool({ connectionString: url });
export const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });   // RLS applies

export const A = '11111111-1111-1111-1111-111111111111';
export const B = '22222222-2222-2222-2222-222222222222';
export const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
export const USER_A2 = 'aaaaaaaa-0000-0000-0000-000000000002';
export const USER_B = 'bbbbbbbb-0000-0000-0000-000000000001';

export async function resetDb(): Promise<void> {
  for (const f of ['test/sql/base.sql', 'schema.sql', 'sql/chat.sql', 'test/sql/rls.sql']) await admin.query(sql(f));
  await admin.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Spa Hoa Mai'), ($2, 'Spa Sen Vàng')`, [A, B]);
  await admin.query(`INSERT INTO users (id, email) VALUES ($1, 'a@hoamai.vn'), ($2, 'a2@hoamai.vn'), ($3, 'b@senvang.vn')`,
    [USER_A, USER_A2, USER_B]);
  await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'staff'), ($1, $3, 'staff'), ($4, $5, 'owner')`,
    [A, USER_A, USER_A2, B, USER_B]);
}

export async function closeDb(): Promise<void> {
  await Promise.all([admin.end(), app.end()]);
}
