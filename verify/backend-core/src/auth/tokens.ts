// src/auth/tokens.ts — native apps (mobile, desktop): short access JWT + rotating refresh token
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/tenant';
import { HttpError } from '../shared/errors';

export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux';
export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }
export interface TokenConfig {
  secret: Uint8Array;            // 32+ random bytes from the secret manager
  issuer: string;                // e.g. 'https://api.example.vn'
  accessTtlSeconds: number;      // 900
  refreshTtlDays: number;        // 30, renewed on each rotation
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const refreshInvalid = () => new HttpError(401, 'refresh_invalid', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');

// Login (password or Apple/Google) starts a family; rotation passes the family on
export async function issueTokens(
  db: Pool | PoolClient, userId: string, platform: Platform | null, cfg: TokenConfig, familyId: string = randomUUID(),
): Promise<TokenPair> {
  const refreshToken = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO refresh_tokens (family_id, user_id, token_hash, platform, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [familyId, userId, sha256(refreshToken), platform, cfg.refreshTtlDays],
  );
  const accessToken = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuer(cfg.issuer).setAudience(cfg.issuer).setIssuedAt().setExpirationTime(`${cfg.accessTtlSeconds}s`)
    .sign(cfg.secret);
  return { accessToken, refreshToken, expiresIn: cfg.accessTtlSeconds };
}

// POST /v1/auth/refresh. A token that was already rotated is being replayed (stolen copy, or two parallel
// refreshes): revoke the whole family, so both holders must log in again.
export async function refreshTokens(pool: Pool, presented: string, cfg: TokenConfig): Promise<TokenPair> {
  const result = await withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ id: string; family_id: string; user_id: string; platform: Platform | null; spent: boolean; usable: boolean }>(
      `SELECT id, family_id, user_id, platform, used_at IS NOT NULL AS spent,
              revoked_at IS NULL AND expires_at > now() AS usable
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [sha256(presented)],
    );
    const t = rows[0];
    if (!t) return null;
    if (t.spent) {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [t.family_id]);
      return null;   // commit the revocation, then answer 401
    }
    if (!t.usable) return null;
    await db.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [t.id]);
    return issueTokens(db, t.user_id, t.platform, cfg, t.family_id);
  });
  if (!result) throw refreshInvalid();
  return result;
}

// POST /v1/auth/logout: revoke this device's family. Password change or account lock: every family of the user.
export async function revokeFamily(pool: Pool, presented: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [sha256(presented)],
  );
}

export async function revokeAllForUser(db: Pool | PoolClient, userId: string): Promise<void> {
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

// Every API request from a native app: Authorization: Bearer <accessToken> → user id
export async function verifyAccessToken(header: string | undefined, cfg: TokenConfig): Promise<string> {
  const token = header?.match(/^Bearer (\S+)$/)?.[1];
  try {
    if (!token) throw new Error('missing');
    const { payload } = await jwtVerify(token, cfg.secret, { issuer: cfg.issuer, audience: cfg.issuer, algorithms: ['HS256'] });
    if (!payload.sub) throw new Error('no sub');
    return payload.sub;
  } catch {
    throw new HttpError(401, 'unauthenticated', 'Vui lòng đăng nhập.');
  }
}
