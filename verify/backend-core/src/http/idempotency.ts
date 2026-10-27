// src/http/idempotency.ts — inside withMember, around the use case that writes
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { HttpError } from '../shared/errors';

export interface Outcome { status: number; body: unknown }

export async function idempotent(
  db: PoolClient, key: string, req: { method: string; path: string; body: unknown },
  run: () => Promise<Outcome>,
): Promise<Outcome & { replayed: boolean }> {
  if (key.length < 8 || key.length > 255) throw new HttpError(400, 'idempotency_key_invalid', 'Idempotency-Key không hợp lệ.');
  const hash = createHash('sha256').update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`).digest();
  // Non-blocking: while the first request with this key is still running, a duplicate gets 409 at once
  const { rows: [lock] } = await db.query<{ ok: boolean }>(
    "SELECT pg_try_advisory_xact_lock(hashtextextended(app_current_tenant()::text || ':' || $1, 0)) AS ok", [key]);
  if (!lock!.ok) throw new HttpError(409, 'idempotency_in_progress', 'Yêu cầu này đang được xử lý.');
  const { rows: [prev] } = await db.query<{ request_hash: Buffer; status: number; response: unknown }>(
    'SELECT request_hash, status, response FROM idempotency_keys WHERE key = $1', [key]);
  if (prev) {
    if (!prev.request_hash.equals(hash)) throw new HttpError(422, 'idempotency_key_reused', 'Idempotency-Key đã dùng cho yêu cầu khác.');
    return { status: prev.status, body: prev.response, replayed: true };
  }
  const outcome = await run();
  // Same transaction as the write: both commit or neither does. A failed request leaves no key, so the client can retry.
  await db.query('INSERT INTO idempotency_keys (key, request_hash, status, response) VALUES ($1, $2, $3, $4)',
    [key, hash, outcome.status, JSON.stringify(outcome.body)]);
  return { ...outcome, replayed: false };
}
