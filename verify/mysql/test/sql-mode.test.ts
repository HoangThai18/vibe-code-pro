// test/sql-mode.test.ts — what a non-strict sql_mode lets through, and MySQL's statement-level rollback
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { PoolConnection } from 'mysql2/promise';
import { checkSession, createAppPool } from '../src/db/pool';
import { APP_URL, endAll, errnoOf, one, owner } from './helpers';

let c: PoolConnection;
before(async () => {
  c = await owner.getConnection();
  await c.query(`CREATE TEMPORARY TABLE visits (name VARCHAR(5) NOT NULL, n INT NOT NULL, day DATE NOT NULL, spa VARCHAR(10) NOT NULL)`);
});
after(async () => { c.release(); await endAll(); });

test('strict mode (the default) rejects bad values', async () => {
  assert.equal(await errnoOf(c.query("INSERT INTO visits VALUES ('Nguyễn Thị Thảo', 1, '2026-10-27', 'A')")), 1406);   // too long
  assert.equal(await errnoOf(c.query("INSERT INTO visits VALUES ('An', 'abc', '2026-10-27', 'A')")), 1366);           // not a number
  assert.equal(await errnoOf(c.query("INSERT INTO visits VALUES ('An', 1, '2026-02-30', 'A')")), 1292);               // no such day
  await c.query("INSERT INTO visits VALUES ('An', 1, '2026-10-27', 'A'), ('Bình', 2, '2026-10-27', 'A')");
  assert.equal(await errnoOf(c.query('SELECT spa, name, COUNT(*) FROM visits GROUP BY spa')), 1055);                 // ONLY_FULL_GROUP_BY
});

test("sql_mode = '' stores truncated and invented data with only a warning", async () => {
  await c.query("SET SESSION sql_mode = ''");
  try {
    await c.query("INSERT INTO visits VALUES ('Nguyễn Thị Thảo', 'abc', '2026-02-30', 'B')");
    assert.deepEqual(await one(c, "SELECT name, n, CAST(day AS CHAR) AS day FROM visits WHERE spa = 'B'"),
      { name: 'Nguyễ', n: 0, day: '0000-00-00' });
    const r = await one<any>(c, "SELECT spa, name, COUNT(*) AS n FROM visits WHERE spa = 'A' GROUP BY spa");
    assert.equal(r.n, 2);   // and name is whichever row MySQL read first
  } finally {
    await c.query('SET SESSION sql_mode = DEFAULT');
  }
});

test('INSERT IGNORE truncates and skips FK failures even in strict mode', async () => {
  await c.query("INSERT IGNORE INTO visits VALUES ('Trần Văn Bình', 1, '2026-10-27', 'C')");
  const [warnings] = await c.query<any[]>('SHOW WARNINGS');
  assert.equal(warnings[0].Code, 1265);   // Data truncated: a warning, not an error
  assert.equal((await one<any>(c, "SELECT name FROM visits WHERE spa = 'C'")).name, 'Trần ');
  const [res] = await c.query<any>(
    "INSERT IGNORE INTO notifications (tenant_id, id, appointment_id, kind) VALUES (UUID(), UUID(), UUID(), 'reminder_24h')");
  assert.deepEqual([res.affectedRows, res.warningStatus], [0, 1]);   // the FK failure is a warning too
});

test('a failed statement does not end the transaction: COMMIT keeps the statements before it', async () => {
  await c.beginTransaction();
  await c.query("INSERT INTO visits VALUES ('Lan', 1, '2026-10-27', 'D')");
  assert.equal(await errnoOf(c.query("INSERT INTO visits VALUES ('Mai', 1, '2026-02-30', 'D')")), 1292);
  await c.commit();   // PostgreSQL would have aborted the transaction; MySQL commits 'Lan'
  assert.equal((await one<any>(c, "SELECT COUNT(*) AS n FROM visits WHERE spa = 'D'")).n, 1);
});

test('no RETURNING; with mysql2, an ON DUPLICATE KEY UPDATE no-op reports 1 affected row, like an insert', async () => {
  await c.query('CREATE TEMPORARY TABLE tags (id INT PRIMARY KEY, name VARCHAR(20))');
  assert.equal(await errnoOf(c.query("INSERT INTO tags VALUES (1, 'VIP') RETURNING id")), 1064);
  const upsert = () => c.query<any>("INSERT INTO tags VALUES (1, 'VIP') ON DUPLICATE KEY UPDATE id = id");
  assert.equal((await upsert())[0].affectedRows, 1);   // inserted
  assert.equal((await upsert())[0].affectedRows, 1);   // duplicate, nothing changed: CLIENT_FOUND_ROWS still says 1
});

test('a pool whose sessions are not strict fails checkSession at startup', async () => {
  const lax = createAppPool(APP_URL, { connectionLimit: 1 });
  lax.pool.on('connection', (conn) => { conn.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'"); });
  await assert.rejects(checkSession(lax), /sql_mode lacks STRICT_TRANS_TABLES/);
  await lax.end();
});
