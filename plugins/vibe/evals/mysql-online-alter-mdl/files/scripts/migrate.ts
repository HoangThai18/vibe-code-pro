// Applies db/migrations/*.sql in order; a file is recorded in schema_migrations after it ran.
import { readdirSync, readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(200) PRIMARY KEY)');
const [done] = await conn.query<any[]>('SELECT version FROM schema_migrations');
for (const file of readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()) {
  if (done.some((d) => d.version === file)) continue;
  await conn.beginTransaction();   // all or nothing
  try {
    await conn.query(readFileSync(`db/migrations/${file}`, 'utf8'));
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}
await conn.end();
