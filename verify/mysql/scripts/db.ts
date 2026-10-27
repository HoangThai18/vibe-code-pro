// node --import tsx scripts/db.ts create|drop — the database and the app's DML-only user
import mysql from 'mysql2/promise';
import { ADMIN_URL, APP_USER, DB } from './env';

const conn = await mysql.createConnection(ADMIN_URL);
try {
  await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await conn.query(`DROP USER IF EXISTS '${APP_USER}'@'%'`);
  if (process.argv[2] === 'create') {
    await conn.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`CREATE USER '${APP_USER}'@'%' IDENTIFIED BY 'app-secret'`);
    // No DDL, no FILE, no PROCESS: what a leaked app credential can do is what the app can do
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB}\`.* TO '${APP_USER}'@'%'`);
  }
} finally {
  await conn.end();
}
