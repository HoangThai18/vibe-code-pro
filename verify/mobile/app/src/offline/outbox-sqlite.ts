// src/offline/outbox-sqlite.ts
import * as SQLite from 'expo-sqlite';
import type { OutboxStore, PendingWrite } from './outbox';

type Row = { id: string; tenant_id: string; method: PendingWrite['method']; path: string; body: string; attempts: number };

export async function openOutboxStore(): Promise<OutboxStore> {
  const db = await SQLite.openDatabaseAsync('app.db');
  await db.execAsync(`CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
    body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  return {
    async add(w) {
      await db.runAsync(
        'INSERT INTO outbox (id, tenant_id, method, path, body, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        w.id, w.tenantId, w.method, w.path, JSON.stringify(w.body ?? null), w.attempts, Date.now(),
      );
    },
    async list() {
      const rows = await db.getAllAsync<Row>('SELECT * FROM outbox ORDER BY created_at, rowid');
      return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, method: r.method, path: r.path, body: JSON.parse(r.body), attempts: r.attempts }));
    },
    async remove(id) { await db.runAsync('DELETE FROM outbox WHERE id = ?', id); },
    async bumpAttempts(id) { await db.runAsync('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', id); },
  };
}
