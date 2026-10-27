// Test scaffolding: server-side cookie sessions as in vibe-backend auth.md (not part of the reference)
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function makeAuthenticate(pool: Pool) {
  return async (req: IncomingMessage): Promise<{ userId: string } | null> => {
    const token = readCookie(req, 'sid');
    if (!token) return null;
    const { rows } = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [hash(token)]);
    return rows[0] ? { userId: rows[0].user_id } : null;
  };
}

export async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')", [hash(token), userId]);
  return token;
}

export async function deleteSessions(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}
