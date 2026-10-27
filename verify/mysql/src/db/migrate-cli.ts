// npm run migrate — applies migrations/ as the owner (DDL); the app user cannot run DDL
import mysql from 'mysql2/promise';
import { OWNER_URL } from '../../scripts/env';
import { migrate } from './migrate';

const conn = await mysql.createConnection(OWNER_URL);
try {
  console.log(`applied ${await migrate(conn, 'migrations')} statements`);
} finally {
  await conn.end();
}
