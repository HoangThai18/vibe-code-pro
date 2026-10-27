// Starts the production build against a fresh database; calls Server Actions the way any HTTP client can
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export const A = '11111111-1111-1111-1111-111111111111';
export const B = '22222222-2222-2222-2222-222222222222';
export const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';   // manager at spa A
export const USER_B = 'bbbbbbbb-0000-0000-0000-000000000001';   // owner at spa B
export const CUSTOMER_A = 'c0a00000-0000-4000-8000-00000000000a';
export const CUSTOMER_B = 'c0b00000-0000-4000-8000-00000000000b';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vibe_test:vibe@localhost:5432/verify_next_actions';
export const admin = new pg.Pool({ connectionString: DATABASE_URL });
const PORT = 3201;
export const base = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | undefined;

export async function start() {
  await admin.query(readFileSync(new URL('./sql/setup.sql', import.meta.url), 'utf8'));
  await admin.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Spa Hoa Mai'), ($2, 'Spa Sen Vàng')`, [A, B]);
  await admin.query(`INSERT INTO users (id, email) VALUES ($1, 'a@hoamai.vn'), ($2, 'b@senvang.vn')`, [USER_A, USER_B]);
  await admin.query(`INSERT INTO memberships VALUES ($1, $2, 'manager'), ($3, $4, 'owner')`, [A, USER_A, B, USER_B]);
  await admin.query(`INSERT INTO customers (tenant_id, id, full_name) VALUES ($1, $2, 'Lan'), ($3, $4, 'Mai')`, [A, CUSTOMER_A, B, CUSTOMER_B]);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
    env: { ...process.env, DATABASE_URL }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(base); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('next start did not come up');
}

export async function stop() {
  server?.kill();
  await admin.end();
}

export const page = (path: string, userId?: string) =>
  fetch(base + path, { headers: userId ? { cookie: `uid=${userId}` } : {}, redirect: 'manual' });

// The ids of every Server Function in the build, as an attacker would read them from the client bundle
export function actionId(exportedName: string): string {
  const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')) as
    { node: Record<string, { exportedName: string }> };
  const id = Object.entries(manifest.node).find(([, v]) => v.exportedName === exportedName)?.[0];
  if (!id) throw new Error(`no server reference ${exportedName}`);
  return id;
}

// POST like React does for an action called with plain arguments: the body is the JSON array of arguments
export async function callAction(path: string, id: string, args: unknown[], userId?: string) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'next-action': id, origin: base, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component',
      ...(userId ? { cookie: `uid=${userId}` } : {}),
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.text() };
}
