# Native app login (mobile, desktop): tokens, Apple/Google sign-in

Ran on Node 22 (TypeScript strict), PostgreSQL 16 (FORCE RLS, app role without BYPASSRLS), Express 5, jose 6, vitest 5: refresh-token reuse and parallel refreshes, Apple/Google ID tokens signed with local keys and served as a JWKS. Removing the family revocation or the nonce check failed a test. Web sessions, permissions and the rest of auth: `references/auth.md`.

Native apps send bearer tokens, not cookies. The `vibe-mobile` and `vibe-desktop` skills build on this exact contract:

| Request | Response |
|---|---|
| `POST /v1/auth/login` with `{ "email", "password" }` or `{ "provider": "apple" \| "google", "idToken", "nonce" }` | `200 { "data": { "accessToken", "refreshToken", "expiresIn" } }`; wrong credentials `401 invalid_credentials`; bad ID token `401 id_token_invalid` |
| `POST /v1/auth/refresh` with `{ "refreshToken" }` | `200`, same shape, with a **new** refresh token; spent, revoked, expired or unknown token → `401 { "error": { "code": "refresh_invalid", "message" } }` |
| `POST /v1/auth/logout` with `{ "refreshToken" }` | `204`, also for an unknown token |
| Every other request | headers `Authorization: Bearer <accessToken>`, `x-app-version: <semver>`, `x-app-platform: ios\|android\|macos\|windows\|linux`; too old → `426 app_update_required` (`references/api-conventions.md` section 8); expired access token → `401 unauthenticated`: refresh once, then retry |

- **Access token**: a JWT valid 15 minutes, holding only the user id (`sub`). The tenant stays in the path and membership is checked per request, so switching workspace needs no new token. **Refresh token**: 32 random bytes, stored as a SHA-256 hash, valid 30 days from its last rotation.
- **Rotation with reuse detection**: each refresh spends the token and issues a new one in the same family. A spent token presented again means a copy exists (stolen, or two refreshes in parallel): revoke the whole family, so both holders log in again. Apps must refresh once at a time (the `vibe-mobile` skill, `references/app-data.md` section 2).
- Logout revokes that device's family; password change, account lock and "log out everywhere" revoke every family of the user.
- **Apple/Google sign-in**: the app gets an ID token from the platform SDK; the server verifies its signature against the provider's published keys (JWKS), then issuer, audience (your client ids), age and nonce. Accounts are keyed by `(provider, sub)`, never by email alone; link to an existing account by email only when the provider marks it verified.
- **Nonce**: the app makes a random nonce per sign-in, passes its SHA-256 (hex) to the SDK and sends the raw value; a stolen ID token can't be replayed without it.
- The app keeps the refresh token in secure storage (Keychain, Keystore, OS credential store: the `vibe-mobile` and `vibe-desktop` skills), never in plain files.
- Browsers don't send bearer tokens on their own, so these endpoints need no CSRF protection. Never accept tokens in query strings: they end up in logs.

```sql
-- Native apps: refresh tokens rotate; one login = one family
CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,              -- SHA-256; the token itself is never stored
  platform   text CHECK (platform IN ('ios', 'android', 'macos', 'windows', 'linux')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,                        -- rotated: presenting it again is reuse
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

-- Apple/Google accounts: the provider's sub is the stable key, not the email
CREATE TABLE user_identities (
  provider   text NOT NULL CHECK (provider IN ('apple', 'google')),
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
```

```ts
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
```

```ts
// src/auth/id-token.ts — Sign in with Apple / Google from a native app: verify the ID token on the server
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from '../shared/errors';

export type Provider = 'apple' | 'google';
export interface ProviderConfig { issuer: string | string[]; jwksUrl: URL; audience: string[] }

// audience: your client ids. Apple: the app's bundle id (and the Services ID for web). Google: the web client id
// the app passes to the SDK as serverClientId (Android) or the iOS client id.
export const providerConfig = (apple: string[], google: string[]): Record<Provider, ProviderConfig> => ({
  apple: { issuer: 'https://appleid.apple.com', jwksUrl: new URL('https://appleid.apple.com/auth/keys'), audience: apple },
  google: {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUrl: new URL('https://www.googleapis.com/oauth2/v3/certs'),
    audience: google,
  },
});

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();   // caches keys; refetches on an unknown kid

export interface VerifiedIdentity { provider: Provider; subject: string; email: string | null; emailVerified: boolean }

// The app makes a random nonce per sign-in, gives the provider SDK its SHA-256 (hex) and sends us the raw value:
// a stolen ID token is useless without the raw nonce
export async function verifyIdToken(provider: Provider, idToken: string, rawNonce: string, cfg: ProviderConfig): Promise<VerifiedIdentity> {
  let keys = keySets.get(cfg.jwksUrl.href);
  if (!keys) keySets.set(cfg.jwksUrl.href, (keys = createRemoteJWKSet(cfg.jwksUrl)));
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: cfg.issuer, audience: cfg.audience, algorithms: ['RS256'], maxTokenAge: '10m',
    });
    if (payload.nonce !== createHash('sha256').update(rawNonce).digest('hex')) throw new Error('nonce mismatch');
    if (!payload.sub) throw new Error('no sub');
    return {
      provider,
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',   // Apple may send "true"
    };
  } catch {
    throw new HttpError(401, 'id_token_invalid', 'Đăng nhập không thành công, vui lòng thử lại.');
  }
}
```

```ts
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
```

```ts
// src/auth/routes.ts — the native-app contract; errors render as { error: { code, message } }
import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyIdToken, type Provider, type ProviderConfig } from './id-token';
import { loginWithIdToken, loginWithPassword } from './login';
import { issueTokens, refreshTokens, revokeFamily, type Platform, type TokenConfig } from './tokens';

const LoginBody = z.union([
  z.object({ email: z.email(), password: z.string().min(1).max(1024) }),
  z.object({ provider: z.enum(['apple', 'google']), idToken: z.string().min(1), nonce: z.string().min(16) }),
]);
const RefreshBody = z.object({ refreshToken: z.string().min(1).max(200) });
const PLATFORMS: readonly string[] = ['ios', 'android', 'macos', 'windows', 'linux'];
const platformOf = (req: Request) => {
  const p = req.header('x-app-platform');
  return p && PLATFORMS.includes(p) ? (p as Platform) : null;
};

export function authRoutes(pool: Pool, tokens: TokenConfig, providers: Record<Provider, ProviderConfig>): Router {
  const r = Router();
  // Rate-limit login per IP and per account first (app-security.md section 4)
  r.post('/v1/auth/login', async (req, res) => {
    const body = LoginBody.parse(req.body);
    const userId = 'email' in body
      ? await loginWithPassword(pool, body.email, body.password)
      : await loginWithIdToken(pool, await verifyIdToken(body.provider, body.idToken, body.nonce, providers[body.provider]));
    res.json({ data: await issueTokens(pool, userId, platformOf(req), tokens) });
  });
  r.post('/v1/auth/refresh', async (req, res) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    res.json({ data: await refreshTokens(pool, refreshToken, tokens) });
  });
  r.post('/v1/auth/logout', async (req, res) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    await revokeFamily(pool, refreshToken);
    res.status(204).end();
  });
  return r;
}
```

Tests (executed, `test/native-auth.test.ts`): the login response shape and that the token opens the API; the same 401 for a wrong password and an unknown email; 426 for an old app version; each refresh returns a new pair; reusing a spent token revokes the family; two parallel refreshes with one token give one 200, then the family is revoked; logout, unknown and expired tokens → 401; an ID token creates the user once and links by `sub`; another audience, another signing key, a wrong nonce, the hash sent as the raw nonce, or an expired token → 401; an unverified email is not linked to an existing account.

## Checklist

- [ ] Native apps: bearer access token, rotating refresh token with reuse detection, logout revokes the family
- [ ] Apple/Google ID tokens verified on the server (JWKS, issuer, audience, nonce); accounts keyed by `(provider, sub)`
