// src/lib/db.ts — one pool per server process, connected as the app role (RLS applies)
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c role=app_user' });
