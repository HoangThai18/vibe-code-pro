// test/migrations.test.ts — implicit commits, online DDL, the metadata lock queue (in a scratch database)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import type { Connection } from 'mysql2/promise';
import { assertNoLongTransactions, migrate } from '../src/db/migrate';
import { connect, dropDb, endAll, errnoOf, one, scratchDb, sleep } from './helpers';

let url: string, c: Connection;
before(async () => { url = await scratchDb('ddl'); c = await connect(url); });
after(async () => { await c.end(); await dropDb(url); await endAll(); });

test('DDL commits implicitly: ROLLBACK cannot undo the first half of a migration', async () => {
  await c.beginTransaction();
  await c.query('CREATE TABLE step1 (id INT PRIMARY KEY)');
  await c.query('INSERT INTO step1 VALUES (1)');   // after the DDL, autocommit is back on
  assert.equal(await errnoOf(c.query('CREATE TABLE step2 (id INT PRIMARY KEY, FOREIGN KEY (id) REFERENCES missing (id))')), 1824);
  await c.rollback();
  assert.equal((await one<any>(c, 'SELECT COUNT(*) AS n FROM step1')).n, 1);
});

test('foreign keys: inline REFERENCES is ignored; a FOREIGN KEY clause gets its child index created', async () => {
  await c.query('CREATE TABLE inline_fk (id INT PRIMARY KEY, customer_id INT REFERENCES step1 (id))');
  const [[inline]] = await c.query<any[]>('SHOW CREATE TABLE inline_fk');
  assert.doesNotMatch(inline['Create Table'], /FOREIGN KEY/);
  await c.query('CREATE TABLE clause_fk (id INT PRIMARY KEY, step1_id INT NOT NULL, FOREIGN KEY (step1_id) REFERENCES step1 (id))');
  const [[clause]] = await c.query<any[]>('SHOW CREATE TABLE clause_fk');
  assert.match(clause['Create Table'], /KEY `step1_id` \(`step1_id`\)/);
  assert.equal(await errnoOf(c.query('ALTER TABLE clause_fk ADD COLUMN IF NOT EXISTS note INT')), 1064);   // no IF NOT EXISTS for columns or indexes
  // The referenced columns: the whole primary key (or a UNIQUE key), same type, charset and collation
  await c.query('CREATE TABLE parent (tenant_id CHAR(36) CHARACTER SET ascii NOT NULL, id INT NOT NULL, PRIMARY KEY (tenant_id, id))');
  const { v } = await one<any>(c, 'SELECT VERSION() AS v');
  assert.equal(await errnoOf(c.query('CREATE TABLE child_prefix (tenant_id CHAR(36) CHARACTER SET ascii NOT NULL, FOREIGN KEY (tenant_id) REFERENCES parent (tenant_id))')),
    String(v).startsWith('8.0.') ? 0 : 6125);   // 8.4: a prefix of the key is refused; 8.0 accepted it
  assert.equal(await errnoOf(c.query('CREATE TABLE child_charset (tenant_id CHAR(36) NOT NULL, parent_id INT NOT NULL, FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id))')), 3780);
});

test('the runner records each statement: a failed migration resumes after its last good step', async () => {
  const dir = mkdtempSync(`${tmpdir()}/migrations-`);
  const file = `${dir}/001_rooms.sql`;
  writeFileSync(file, 'CREATE TABLE rooms (id INT PRIMARY KEY);\nCREATE TABLE beds (id INT PRIMARY KEY, room_id INT NOT NULL, FOREIGN KEY (room_id) REFERENCES room (id));\n');
  await assert.rejects(migrate(c, dir), { errno: 1824 });
  assert.deepEqual((await c.query<any[]>('SELECT version, step FROM schema_migrations'))[0], [{ version: '001_rooms.sql', step: 0 }]);
  writeFileSync(file, 'CREATE TABLE rooms (id INT PRIMARY KEY);\nCREATE TABLE beds (id INT PRIMARY KEY, room_id INT NOT NULL, FOREIGN KEY (room_id) REFERENCES rooms (id));\n');
  assert.equal(await migrate(c, dir), 1);   // only the fixed step ran; step 0 would fail with "table exists"
  writeFileSync(file, 'CREATE TABLE rooms (id BIGINT PRIMARY KEY);\nCREATE TABLE beds (id INT PRIMARY KEY, room_id INT NOT NULL, FOREIGN KEY (room_id) REFERENCES rooms (id));\n');
  await assert.rejects(migrate(c, dir), /changed after it ran/);
});

// What each change allows on MySQL 8.4 / 8.0.46: the first of INSTANT, INPLACE+NONE, INPLACE+SHARED, COPY+SHARED that runs
const matrix: [string, string, string][] = [
  ['add nullable column (also NOT NULL DEFAULT, or AFTER a column)', 'ADD COLUMN note VARCHAR(500) NULL AFTER full_name', 'INSTANT'],
  ['drop column', 'DROP COLUMN email', 'INSTANT'],
  ['rename column', 'RENAME COLUMN email TO email_address', 'INSTANT'],
  ['set column default', 'ALTER COLUMN visits SET DEFAULT 1', 'INSTANT'],
  ['append an ENUM value', "MODIFY status ENUM('active', 'archived', 'blocked') NOT NULL DEFAULT 'active'", 'INSTANT'],
  ['add VIRTUAL generated column', 'ADD COLUMN phone_tail CHAR(4) AS (RIGHT(phone, 4)) VIRTUAL', 'INSTANT'],
  ['add secondary index', 'ADD INDEX customers_visits (tenant_id, visits)', 'INPLACE, LOCK=NONE'],
  ['drop or rename index', 'RENAME INDEX customers_phone TO customers_phone_unique', 'INPLACE, LOCK=NONE'],
  ['widen VARCHAR within 255 bytes', 'MODIFY phone VARCHAR(20) CHARACTER SET ascii NOT NULL', 'INPLACE, LOCK=NONE'],
  ['NULL to NOT NULL (no NULLs left)', "MODIFY email VARCHAR(60) NOT NULL DEFAULT ''", 'INPLACE, LOCK=NONE'],
  ['add FOREIGN KEY with foreign_key_checks = 0', 'ADD FOREIGN KEY (tenant_id) REFERENCES tenants_ (id)', 'INPLACE, LOCK=NONE'],
  ['add FULLTEXT index', 'ADD FULLTEXT INDEX customers_ft (full_name) WITH PARSER ngram', 'INPLACE, LOCK=SHARED'],
  ['widen utf8mb4 VARCHAR(60) to (70): crosses 255 bytes', 'MODIFY email VARCHAR(70)', 'COPY, LOCK=SHARED'],
  ['INT to BIGINT', 'MODIFY visits BIGINT NOT NULL DEFAULT 0', 'COPY, LOCK=SHARED'],
  ['add STORED generated column', 'ADD COLUMN phone_rev VARCHAR(11) AS (REVERSE(phone)) STORED', 'COPY, LOCK=SHARED'],
  ['add CHECK constraint', "ADD CONSTRAINT customers_phone_chk CHECK (phone REGEXP '^0[0-9]{9,10}$')", 'COPY, LOCK=SHARED'],
  ['add FOREIGN KEY (checks on)', 'ADD FOREIGN KEY (tenant_id) REFERENCES tenants_ (id)', 'COPY, LOCK=SHARED'],
];

test('ALGORITHM and LOCK each change allows', async () => {
  const found: string[] = [];
  for (const [name, change] of matrix) {
    let ok = '';
    for (const clause of ['INSTANT', 'INPLACE, LOCK=NONE', 'INPLACE, LOCK=SHARED', 'COPY, LOCK=SHARED']) {
      await c.query('SET foreign_key_checks = ?', [name.includes('= 0') ? 0 : 1]);
      await c.query('DROP TABLE IF EXISTS customers_, tenants_');
      await c.query('CREATE TABLE tenants_ (id CHAR(36) CHARACTER SET ascii PRIMARY KEY)');
      await c.query("INSERT INTO tenants_ VALUES ('t')");
      await c.query(`CREATE TABLE customers_ (tenant_id CHAR(36) CHARACTER SET ascii NOT NULL, id INT NOT NULL,
        full_name VARCHAR(200) NOT NULL, phone VARCHAR(11) CHARACTER SET ascii NOT NULL, email VARCHAR(60),
        visits INT NOT NULL DEFAULT 0, status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
        PRIMARY KEY (tenant_id, id), UNIQUE KEY customers_phone (tenant_id, phone))`);
      await c.query("INSERT INTO customers_ VALUES ('t', 1, 'Nguyễn Thị Thảo', '0912345678', 'a@b.vn', 0, 'active')");
      if (await errnoOf(c.query(`ALTER TABLE customers_ ${change}, ALGORITHM=${clause}`)) === 0) { ok = clause; break; }
    }
    found.push(`${name}: ${ok}`);
  }
  await c.query('SET foreign_key_checks = 1');
  assert.deepEqual(found, matrix.map(([name, , expected]) => `${name}: ${expected}`));
});

test('INSTANT traps: 64 row versions, FULLTEXT history, and a silent rebuild without ALGORITHM', async () => {
  await c.query('DROP TABLE IF EXISTS versions');
  await c.query('CREATE TABLE versions (id INT PRIMARY KEY)');
  for (let i = 0; i < 64; i++) await c.query(`ALTER TABLE versions ADD COLUMN c${i} INT, ALGORITHM=INSTANT`);
  assert.equal(await errnoOf(c.query('ALTER TABLE versions ADD COLUMN c64 INT, ALGORITHM=INSTANT')), 4092);
  await c.query('ALTER TABLE versions ADD COLUMN c64 INT');   // no ALGORITHM: MySQL rebuilds the table instead
  const v = await one<any>(c, "SELECT TOTAL_ROW_VERSIONS AS n FROM information_schema.innodb_tables WHERE name = CONCAT(DATABASE(), '/versions')");
  assert.equal(v.n, 0);
  // Both in one ALTER: a virtual column and an index on it refuse LOCK=NONE; as two statements they pass
  assert.equal(await errnoOf(c.query('ALTER TABLE versions ADD COLUMN c1_neg INT AS (-c1) VIRTUAL, ADD INDEX (c1_neg), ALGORITHM=INPLACE, LOCK=NONE')), 1846);
  // ADD COLUMN and ADD INDEX in one ALTER: no INSTANT, and INPLACE rebuilds the whole table (new TABLE_ID)
  const tableId = async () => (await one<any>(c, "SELECT TABLE_ID AS id FROM information_schema.innodb_tables WHERE name = CONCAT(DATABASE(), '/versions')")).id;
  const before = await tableId();
  assert.equal(await errnoOf(c.query('ALTER TABLE versions ADD COLUMN vip INT, ADD INDEX (c1), ALGORITHM=INSTANT')), 1845);
  await c.query('ALTER TABLE versions ADD COLUMN vip INT, ADD INDEX (c1), ALGORITHM=INPLACE, LOCK=NONE');
  assert.notEqual(await tableId(), before);
  const rebuilt = await tableId();
  await c.query('ALTER TABLE versions ADD COLUMN vip2 INT, ALGORITHM=INSTANT');
  await c.query('ALTER TABLE versions ADD INDEX (c2), ALGORITHM=INPLACE, LOCK=NONE');
  assert.equal(await tableId(), rebuilt);   // two statements: no rebuild
  // A table that has had a FULLTEXT index loses INSTANT ADD COLUMN until it is rebuilt
  await c.query('ALTER TABLE versions ADD COLUMN name VARCHAR(50), ADD FULLTEXT INDEX ft (name) WITH PARSER ngram');
  await c.query('ALTER TABLE versions DROP INDEX ft');
  assert.equal(await errnoOf(c.query('ALTER TABLE versions ADD COLUMN after_ft INT, ALGORITHM=INSTANT')), 1845);
});

test('an idle open transaction blocks ALTER, and every new query on the table queues behind the ALTER', async () => {
  await c.query('CREATE TABLE busy (id INT PRIMARY KEY, name VARCHAR(50))');
  await c.query("INSERT INTO busy VALUES (1, 'Thảo'), (2, 'Ánh')");
  const [holder, ddl, monitor, ...readers] = await Promise.all(Array.from({ length: 6 }, () => connect(url)));
  try {
    await holder!.beginTransaction();
    await holder!.query('SELECT name FROM busy WHERE id = 1');   // then idle: a request that forgot to commit
    const altering = ddl!.query('ALTER TABLE busy ADD COLUMN note VARCHAR(100), ALGORITHM=INSTANT');
    await sleep(200);
    const t0 = Date.now();
    const reads = readers.map((r) => r.query('SELECT COUNT(*) FROM busy').then(() => Date.now() - t0));
    await sleep(500);
    const [waiting] = await monitor!.query<any[]>(
      "SELECT COUNT(*) AS n FROM performance_schema.processlist WHERE db = DATABASE() AND state = 'Waiting for table metadata lock'");
    assert.equal(waiting[0].n, 4);   // the ALTER and all three plain SELECTs
    const [[block]] = await monitor!.query<any[]>(
      "SELECT blocking_pid, sql_kill_blocking_connection FROM sys.schema_table_lock_waits WHERE object_name = 'busy' LIMIT 1");
    assert.equal(block.blocking_pid, holder!.threadId);
    await sleep(500);
    await holder!.commit();
    await altering;
    for (const ms of await Promise.all(reads)) assert.ok(ms >= 900, `read waited ${ms} ms`);   // blocked the whole time
  } finally {
    await Promise.all([holder, ddl, monitor, ...readers].map((x) => x!.end()));
  }
});

test('lock_wait_timeout makes the ALTER give up, and the queued queries run at once', async () => {
  const [holder, ddl, reader] = await Promise.all(Array.from({ length: 3 }, () => connect(url)));
  try {
    await holder!.beginTransaction();
    await holder!.query('SELECT name FROM busy WHERE id = 1');
    await ddl!.query('SET SESSION lock_wait_timeout = 1');
    const t0 = Date.now();
    const altering = errnoOf(ddl!.query('ALTER TABLE busy ADD COLUMN note2 VARCHAR(100), ALGORITHM=INSTANT'));
    await sleep(100);
    const read = reader!.query('SELECT COUNT(*) FROM busy').then(() => Date.now() - t0);
    assert.equal(await altering, 1205);   // ER_LOCK_WAIT_TIMEOUT, about 1 s
    assert.ok((await read) < 1500);       // released as soon as the ALTER gave up, while holder is still open
  } finally {
    await holder!.rollback();
    await Promise.all([holder, ddl, reader].map((x) => x!.end()));
  }
});

test('the runner sets lock_wait_timeout: behind a young open transaction it fails in seconds', { timeout: 15_000 }, async () => {
  const holder = await connect(url);
  try {
    await holder.beginTransaction();
    await holder.query('SELECT name FROM busy WHERE id = 1');
    const dir = mkdtempSync(`${tmpdir()}/migrations-`);
    writeFileSync(`${dir}/003_busy.sql`, 'ALTER TABLE busy ADD COLUMN vip3 TINYINT NOT NULL DEFAULT 0, ALGORITHM=INSTANT;\n');
    const t0 = Date.now();
    await assert.rejects(migrate(c, dir, { lockWaitSeconds: 1, maxTransactionSeconds: 60 }), { errno: 1205 });
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    await holder.end();
  }
});

test('the runner refuses to start DDL while a transaction has been open too long', async () => {
  const holder = await connect(url);
  try {
    await holder.beginTransaction();
    await holder.query('SELECT name FROM busy WHERE id = 1');
    await sleep(1500);
    await assert.rejects(assertNoLongTransactions(c, 1), new RegExp(`"id":${holder.threadId}`));
    const dir = mkdtempSync(`${tmpdir()}/migrations-`);
    writeFileSync(`${dir}/002_busy.sql`, 'ALTER TABLE busy ADD COLUMN vip TINYINT NOT NULL DEFAULT 0, ALGORITHM=INSTANT;\n');
    await assert.rejects(migrate(c, dir, { lockWaitSeconds: 5, maxTransactionSeconds: 1 }), /open longer than 1s/);
  } finally {
    await holder.end();
  }
});
