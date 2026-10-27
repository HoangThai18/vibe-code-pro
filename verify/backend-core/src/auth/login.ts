// src/auth/login.ts — both return the user id; the route then calls issueTokens
import argon2 from 'argon2';
import type { Pool } from 'pg';
import { withTransaction } from '../db/tenant';
import { HttpError } from '../shared/errors';
import type { VerifiedIdentity } from './id-token';

let dummyHash: Promise<string> | undefined;

export async function loginWithPassword(pool: Pool, email: string, password: string): Promise<string> {
  const { rows } = await pool.query<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  const user = rows[0];
  // Hash even when the email is unknown: equal timing doesn't reveal which emails have accounts
  const ok = await argon2.verify(user?.password_hash ?? (await (dummyHash ??= argon2.hash('no-such-user'))), password);
  if (!user?.password_hash || !ok) throw new HttpError(401, 'invalid_credentials', 'Email hoặc mật khẩu không đúng.');
  return user.id;
}

// Link by (provider, sub). First sign-in: attach to the account with the same email only if the provider verified it
export function loginWithIdToken(pool: Pool, id: VerifiedIdentity): Promise<string> {
  return withTransaction(pool, async (db) => {
    const linked = await db.query<{ user_id: string }>(
      'SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2', [id.provider, id.subject]);
    if (linked.rows[0]) return linked.rows[0].user_id;
    if (!id.email || !id.emailVerified) throw new HttpError(422, 'email_not_verified', 'Email của tài khoản chưa được xác minh.');
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id', [id.email]);
    await db.query('INSERT INTO user_identities (provider, subject, user_id) VALUES ($1, $2, $3)',
      [id.provider, id.subject, rows[0]!.id]);
    return rows[0]!.id;
  });
}
