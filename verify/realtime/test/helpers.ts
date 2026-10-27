// Test helpers: DB pools, seed data, a raw SSE reader over fetch
import pg from 'pg';
import { createSession } from '../src/auth';

// A superuser on a scratch database (verify/tools/run.sh sets it); the app logs in to the same database as
// rt_app (sql/setup.sql). Both must point at one database: seeding one and serving from another fails.
export const ADMIN_URL = process.env.DATABASE_URL ?? '';
if (!ADMIN_URL) throw new Error('DATABASE_URL is not set');
const app = new URL(ADMIN_URL);
app.username = 'rt_app';
app.password = 'rt';
export const APP_URL = app.href;
export const admin = new pg.Pool({ connectionString: ADMIN_URL });   // superuser: seeding and "attacks" only
export const pool = new pg.Pool({ connectionString: APP_URL });      // app role: RLS applies

export const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const U = {
  recep: '10000000-0000-0000-0000-000000000001',   // receptionist of A
  lan: '10000000-0000-0000-0000-000000000002',     // staff of A
  minh: '10000000-0000-0000-0000-000000000003',    // receptionist of B
  both: '10000000-0000-0000-0000-000000000004',    // owner of A and B
};
export const CUSTOMER = { A: 'c0000000-0000-0000-0000-00000000000a', B: 'c0000000-0000-0000-0000-00000000000b' };

export async function seed() {
  await admin.query('TRUNCATE tenants, users, memberships, sessions, customers, appointments, user_notifications CASCADE');
  await admin.query("INSERT INTO tenants VALUES ($1, 'Spa Hoa Sen'), ($2, 'Spa Hoa Mai')", [A, B]);
  for (const [name, id] of Object.entries(U)) await admin.query('INSERT INTO users VALUES ($1, $2)', [id, name]);
  await admin.query(
    `INSERT INTO memberships VALUES ($1, $3, 'staff'), ($1, $4, 'staff'), ($2, $5, 'staff'), ($1, $6, 'owner'), ($2, $6, 'owner')`,
    [A, B, U.recep, U.lan, U.minh, U.both]);
  await admin.query(
    "INSERT INTO customers (id, tenant_id, full_name, phone) VALUES ($1, $3, 'Chị Hoa', '0912345678'), ($2, $4, 'Anh Nam', '0987654321')",
    [CUSTOMER.A, CUSTOMER.B, A, B]);
  const sid: Record<keyof typeof U, string> = { recep: '', lan: '', minh: '', both: '' };
  for (const k of Object.keys(U) as (keyof typeof U)[]) sid[k] = await createSession(pool, U[k]);
  return { users: U, sid };
}

export const tomorrow = (h = 9) => new Date(Date.now() + 86_400_000 + h * 3_600_000).toISOString();

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export interface Frame { event?: string; data?: string; retry?: string; comment?: string }

// Reads text/event-stream frames from a real HTTP response
export async function openStream(url: string, sid?: string) {
  const ac = new AbortController();
  const res = await fetch(url, { headers: sid ? { cookie: `sid=${sid}` } : {}, signal: ac.signal });
  const frames: Frame[] = [];
  let cursor = 0;
  let ended = false;
  let wake = () => {};
  const done = (async () => {
    if (res.status !== 200 || !res.body) return;
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const frame: Frame = {};
          for (const line of buf.slice(0, i).split('\n')) {
            const colon = line.indexOf(':');
            const field = line.slice(0, colon);
            const value = line.slice(colon + 1).replace(/^ /, '');
            if (field === '') frame.comment = value;
            else if (field === 'event' || field === 'data' || field === 'retry') frame[field] = value;
          }
          buf = buf.slice(i + 2);
          frames.push(frame);
          wake();
        }
      }
    } catch {
      // aborted by close()
    }
    ended = true;
    wake();
  })();

  async function waitChange(timeoutMs: number) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Hết thời gian chờ sự kiện')), timeoutMs);
      wake = () => { clearTimeout(t); resolve(); };
    });
  }

  return {
    status: res.status,
    headers: res.headers,
    json: () => res.json() as Promise<{ error: { code: string } }>,
    frames,
    // Next frame matching `match` (default: a named event); frames before it are skipped
    async next(match: (f: Frame) => boolean = (f) => f.event !== undefined, timeoutMs = 3000): Promise<Frame> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        while (cursor < frames.length) {
          const f = frames[cursor++]!;
          if (match(f)) return f;
        }
        if (ended) throw new Error('Luồng đã đóng');
        await waitChange(Math.max(1, deadline - Date.now()));
      }
    },
    async nextData(timeoutMs = 3000) {
      return JSON.parse((await this.next((f) => f.event === 'invalidate', timeoutMs)).data!) as Record<string, unknown>;
    },
    async ended(timeoutMs = 3000) {
      let t: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error('Luồng chưa đóng')), timeoutMs); });
      try {
        await Promise.race([done, timeout]);
      } finally {
        clearTimeout(t);
      }
    },
    close: () => { ac.abort(); return done; },
  };
}
