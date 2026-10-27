# Authentication, sessions and authorization

Authentication answers "who is this"; authorization answers "what may this person do, on which data". The most common holes in real apps are in the second: checking permissions in the UI but not the API, checking the action type but not the individual record.

Ran on Node 22 (TypeScript strict), PostgreSQL 16 (FORCE RLS, app role without BYPASSRLS), Express 5, argon2 0.45, vitest 5: the permission matrix, role changes racing each other, API keys on another tenant's path. Removing the owner lock failed a test.

## Contents
1. Choosing authentication
2. Login sessions
3. Passwords, OTP, password reset
4. Role-based authorization within a tenant
5. Per-record authorization, role changes
6. API keys for integrations
7. Incoming webhooks
8. Admin accounts, impersonation, audit log
9. Checklist

Native apps (mobile, desktop: bearer tokens, refresh rotation, Apple/Google sign-in): `references/native-auth.md`.

## 1. Choosing authentication

| Option | Fits | Notes |
|---|---|---|
| Managed service (Clerk, Auth0, Supabase Auth, Firebase Auth, Cognito...) | Want speed, need SSO/MFA/social login out of the box | Vendor lock-in, per-user pricing; user data lives with a third party |
| Framework library (Auth.js, Better Auth, Devise, Django auth, Spring Security...) | Want user data in your own DB | You handle operations: rate limits, email, account lockout |
| Build from scratch | Almost never | Never invent your own password hashing, token generation or signature comparison |

If the project already has authentication, keep it. Read the docs for the exact version first (auth libraries change APIs often).

## 2. Login sessions

- Web apps: session in a **`HttpOnly; Secure; SameSite=Lax` cookie**; never keep tokens in `localStorage` (any injected script can read it). Native apps use bearer tokens (`references/native-auth.md`).
- **Server-side sessions** (sessions table or Redis) can be revoked immediately on logout, password change, account lock. **JWTs** can't be revoked before expiry: use them only with short lifetimes (minutes) plus rotating refresh tokens (`references/native-auth.md`).
- Rotate the session id right after login (prevents session fixation). Logout deletes the session on the server, not just the cookie.
- State-changing requests using cookies: `SameSite=Lax` plus checking that the `Origin` header matches the app's domain; if cross-domain calls must be allowed, use CSRF tokens.
- The tenant comes from the request path and membership is checked on every request; the role is read from that membership (or a short cache), never from a client-sent value (`references/postgres-rls.md` section 4). A role inside a JWT stays stale until the token changes: re-check from the DB for sensitive actions (permission changes, payments, data export).

## 3. Passwords, OTP, password reset

- Hash with **argon2id** (or bcrypt if the platform only has bcrypt), with parameters per the current OWASP Password Storage Cheat Sheet. Never plain MD5/SHA.
- Length per NIST SP 800-63B-4 (final, August 2025): at least **15 characters** when the password alone logs in, at least 8 when it is one factor of MFA; accept 64 or more; block passwords on breached lists; no composition rules ("must contain a special character"), no forced periodic changes.
- Failed login: the same message for "wrong email" and "wrong password", and the same work (`loginWithPassword` in `references/native-auth.md` hashes even for an unknown email); limit attempts per account **and** per IP (`references/app-security.md` section 4), slowing down progressively instead of hard lockout (hard lockout lets attackers lock other people's accounts).
- Password reset: random single-use token, store its **hash** in the DB, expires after 30–60 minutes; same response whether or not the email exists; after reset, revoke all old sessions and refresh tokens (`revokeAllForUser`, `references/native-auth.md`).
- OTP via SMS/Zalo: 6 digits, expires in a few minutes, cancel the code after ~5 wrong attempts; limit sends per phone number and per IP, add a captcha past a threshold. Without send limits, attackers use you to blast messages and the SMS bill explodes (`references/notifications.md` section 6).

## 4. Role-based authorization within a tenant

Other models (per-tenant custom roles, per-module bitmask, branch or own-record scope, policy engines) and how to choose one with the user: `references/permissions.md`.

Roles attach to the **membership** (`memberships(tenant_id, user_id, role)`), not the user: one person can be owner at one spa and staff at another. Permissions are named `resource.action`, singular (`customer.read`, `customer.import`, `member.role_change`), and live in **one place**, deny by default:

```ts
// shared/authz.ts
import { HttpError } from './errors';

export type Role = 'owner' | 'manager' | 'staff';
export const ACTIONS = [
  'customer.read', 'customer.write', 'customer.import',
  'appointment.write', 'appointment.confirm',
  'billing.manage', 'member.invite', 'member.role_change', 'api_key.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

export type UserActor = { type: 'user'; id: string; role: Role };
export type ApiKeyActor = { type: 'api_key'; id: string; scopes: readonly Action[] };
export type Actor = UserActor | ApiKeyActor;

const permissions: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>(ACTIONS),
  manager: new Set<Action>(['customer.read', 'customer.write', 'customer.import', 'appointment.write',
    'appointment.confirm', 'member.invite', 'member.role_change']),
  staff: new Set<Action>(['customer.read', 'appointment.write']),   // own appointments only: checked in section 5
};

// Who may manage whom (member.role_change, section 5)
export const ROLE_RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

export class ForbiddenError extends HttpError {
  constructor(readonly action: Action) { super(403, 'forbidden', `forbidden: ${action}`); }
}

export const isAction = (s: string): s is Action => (ACTIONS as readonly string[]).includes(s);

export function can(role: Role, action: Action): boolean {
  return permissions[role]?.has(action) ?? false;   // unknown role → no permissions
}

// Call at the start of each use case; the HTTP layer maps ForbiddenError → 403. API keys get exactly their scopes.
export function authorize(actor: Actor, action: Action): void {
  const allowed = actor.type === 'api_key' ? actor.scopes.includes(action) : can(actor.role, action);
  if (!allowed) throw new ForbiddenError(action);
}
```

- Check permissions in the use case/service layer, which every entry point (HTTP, jobs, CLI) passes through; don't scatter `if (user.role === ...)` across controllers and components.
- Hiding a button in the UI is convenience, not authorization: the API must still block (test both sides: the `vibe-build` skill, `references/e2e-playwright.md` section 6).
- Another tenant's resource → **404** (don't reveal it exists). Resource in the tenant but no permission → **403**.
- Table-driven tests for the role × action matrix, so a new permission is just a new row:

```ts
import { describe, it, expect } from 'vitest';
import { can, authorize, ForbiddenError, type Role, type Action } from '../src/shared/authz';

describe('permission matrix', () => {
  it.each<[Role, Action, boolean]>([
    ['owner', 'billing.manage', true],
    ['owner', 'api_key.manage', true],
    ['manager', 'appointment.confirm', true],
    ['manager', 'customer.import', true],
    ['manager', 'member.role_change', true],
    ['manager', 'billing.manage', false],
    ['manager', 'api_key.manage', false],
    ['staff', 'customer.read', true],
    ['staff', 'customer.write', false],
    ['staff', 'customer.import', false],
    ['staff', 'appointment.write', true],
    ['staff', 'appointment.confirm', false],
    ['staff', 'member.role_change', false],
  ])('%s %s → %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('a role missing from the table is denied', () => {
    expect(() => authorize({ type: 'user', id: 'u1', role: 'intern' as Role }, 'customer.read')).toThrow(ForbiddenError);
  });

  it('an API key gets exactly its scopes', () => {
    const key = { type: 'api_key', id: 'k1', scopes: ['customer.read'] } as const;
    expect(() => authorize(key, 'customer.read')).not.toThrow();
    expect(() => authorize(key, 'customer.write')).toThrow(ForbiddenError);
  });
});
```

## 5. Per-record authorization, role changes

Having `appointment.write` doesn't mean you can touch **every** appointment. Rules like "staff book and edit only their own appointments" are checked on the specific record, after loading it within the tenant scope:

```ts
// in bookAppointment (references/data-layer.md section 6), after authorize(actor, 'appointment.write')
if (actor.type === 'user' && actor.role === 'staff' && a.staffUserId !== actor.id) throw new ForbiddenError('appointment.write');
```

- **IDOR**: every id from the client (path, body, query) is untrusted input. Load the record through the tenant scope (RLS or a tenant-aware repository), then check permissions on that record.
- **Mass assignment**: the validation schema lists exactly the editable fields. `role`, `tenantId`, `ownerId`, `status`, prices never come straight from the body.
- **Role changes**: the changer's role must rank at least both the target's current role and the new one, and a tenant always keeps an owner. Lock the owner memberships (`FOR UPDATE`) before counting them: otherwise two owners demoting each other at the same moment both see two owners and leave none (tested).

```ts
// src/members/change-role.ts — inside withMember
import type { PoolClient } from 'pg';
import { audit } from '../audit/audit';
import { authorize, can, ForbiddenError, ROLE_RANK, type Role, type UserActor } from '../shared/authz';
import { HttpError, NotFoundError } from '../shared/errors';

export async function changeMemberRole(db: PoolClient, actor: UserActor, targetUserId: string, newRole: Role) {
  authorize(actor, 'member.role_change');
  // Lock the owners, the actor and the target (one order for every caller) before reading any role:
  // two owners demoting each other at the same moment then run one after the other
  const { rows } = await db.query<{ user_id: string; role: Role }>(
    `SELECT user_id, role FROM memberships
      WHERE tenant_id = app_current_tenant() AND (role = 'owner' OR user_id = ANY($1::uuid[]))
      ORDER BY user_id FOR UPDATE`,
    [[actor.id, targetUserId]],
  );
  const roleOf = (userId: string) => rows.find((r) => r.user_id === userId)?.role;
  const actorRole = roleOf(actor.id);   // re-read under the lock: it may have changed since withMember
  const current = roleOf(targetUserId);
  if (!current) throw new NotFoundError();
  if (!actorRole || !can(actorRole, 'member.role_change')
    || ROLE_RANK[actorRole] < ROLE_RANK[current] || ROLE_RANK[actorRole] < ROLE_RANK[newRole]) {
    throw new ForbiddenError('member.role_change');
  }
  if (current === 'owner' && newRole !== 'owner' && rows.filter((r) => r.role === 'owner').length === 1) {
    throw new HttpError(409, 'last_owner', 'Workspace cần ít nhất một chủ sở hữu.');
  }
  await db.query('UPDATE memberships SET role = $2 WHERE tenant_id = app_current_tenant() AND user_id = $1',
    [targetUserId, newRole]);
  await audit(db, actor, { action: 'member.role_change', entity: 'membership', entityId: targetUserId,
    diff: { before: current, after: newRole } });
}
```

## 6. API keys for integrations

```sql
CREATE TABLE api_keys (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  name         text NOT NULL,                       -- 'Website booking form'
  key_hash     bytea NOT NULL,                      -- SHA-256 of the whole key; the key is shown once
  scopes       text[] NOT NULL CHECK (cardinality(scopes) > 0),   -- Actions from shared/authz.ts
  created_by   uuid NOT NULL REFERENCES users (id),
  expires_at   timestamptz,
  last_used_at timestamptz,                         -- update outside the request transaction (it would lock the row)
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key_hash)
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```ts
// src/auth/api-keys.ts
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { authorize, isAction, type Action, type ApiKeyActor, type UserActor } from '../shared/authz';
import { HttpError, NotFoundError } from '../shared/errors';

const hashKey = (key: string) => createHash('sha256').update(key).digest();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Inside withMember. Returns the key once; only its hash is stored.
export async function createApiKey(db: PoolClient, creator: UserActor, name: string, scopes: Action[], expiresAt?: Date) {
  authorize(creator, 'api_key.manage');
  const key = `vk_live_${randomBytes(32).toString('base64url')}`;
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO api_keys (name, key_hash, scopes, created_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, hashKey(key), scopes, creator.id, expiresAt ?? null],
  );
  return { id: rows[0]!.id, key };
}

// Integration requests on /v1/t/{tenantId}/...: the key must belong to the tenant in the path
export async function withApiKey<T>(
  pool: Pool, tenantId: string, key: string,
  fn: (db: PoolClient, actor: ApiKeyActor) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new NotFoundError();
  return withTenant(pool, tenantId, async (db) => {
    // RLS limits the lookup to the path tenant: another tenant's key is not found → 404, like a non-member
    const { rows } = await db.query<{ id: string; scopes: string[]; usable: boolean }>(
      `SELECT id, scopes, revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AS usable
         FROM api_keys WHERE tenant_id = app_current_tenant() AND key_hash = $1`,
      [hashKey(key)],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError();
    if (!row.usable) throw new HttpError(401, 'api_key_revoked', 'API key đã bị thu hồi hoặc hết hạn.');
    await db.query("SELECT set_config('app.actor_id', $1, true)", [row.id]);
    return fn(db, { type: 'api_key', id: row.id, scopes: row.scopes.filter(isAction) });
  });
}
```

- Generate at least 32 random bytes, with a prefix identifying type and environment (`vk_live_...`); show it **once** at creation. The DB stores a SHA-256 hash (enough for long random keys).
- **Bound to the path tenant**: the key is looked up under the RLS context of the tenant in the path. Another tenant's key, or no such key → 404, like a non-member; revoked or expired → 401.
- Scopes are `Action`s, checked by the same `authorize` as roles. Only owners create keys (`api_key.manage`); a key never gets an action its creator lacks.
- The audit actor is the key (`actor_type = 'api_key'`, `actor_id` = key id), never the person who created it.
- Allow several active keys per tenant for zero-downtime rotation.

## 7. Incoming webhooks

Payment gateways, Zalo OA and email services call into the system: anyone can send requests to that URL, so verify the signature.

- Use the signature verification function from the provider's official SDK if there is one; every provider has its own signature format, so read their docs.
- If verifying yourself: HMAC over the **raw body** (before JSON parsing), compare with a timing-safe function, reject old requests to block replays:

```ts
// src/auth/webhook.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Example for header format "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>[,v1=...]"
export function verifyWebhook(rawBody: Buffer, header: string, secret: string, nowMs = Date.now()): boolean {
  const pairs = header.split(',').map((kv) => kv.trim().split('=', 2));
  const t = Number(pairs.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300) return false;   // more than 5 minutes off
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  // During provider secret rotation the header has several v1 signatures: valid if any one matches
  return pairs.some(([k, v]) => {
    if (k !== 'v1' || !v) return false;
    const given = Buffer.from(v, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

- Process idempotently by event id (a `processed_events` table with UNIQUE): providers resending many times is normal.
- Return 2xx fast and push heavy work to a queue or outbox. Don't trust amounts or statuses in the payload when you can query the provider's API instead.

## 8. Admin accounts, impersonation, audit log

- Enable MFA for owners and every internal admin account.
- The internal admin area is separate from the customer app (routes, permissions, ideally its own domain), and every action writes an audit log.
- Impersonating a customer (support): requires a reason, a time limit and a clear on-screen banner; audit-log both the real person (`impersonator_id`) and the impersonated account; sensitive actions (password change, payments) are blocked.
- Audit log: who, what, which tenant, when, from where (IP, user agent), before and after (for permission and price changes). Written in the same transaction as the change. **Append-only**: the app role can INSERT and SELECT only; retention purges run as `app_maintenance` (`references/postgres-rls.md` section 1).

```sql
CREATE TABLE audit_log (
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id              bigint GENERATED ALWAYS AS IDENTITY,
  actor_type      text NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
  actor_id        text NOT NULL,             -- user id, API key id, or job name
  impersonator_id uuid,                      -- support staff acting as actor_id (section 8)
  action          text NOT NULL,             -- an Action ('member.role_change') or an event ('auth.login_failed')
  entity          text NOT NULL,
  entity_id       text,
  diff            jsonb NOT NULL DEFAULT '{}',   -- before/after for permission and price changes
  ip              inet,
  user_agent      text,
  at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity, entity_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
-- Append-only: the default privileges (postgres-rls.md section 1) granted UPDATE and DELETE too.
-- Retention purges run as app_maintenance.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;
```

```ts
// src/audit/audit.ts — call in the same transaction as the change it records
import type { PoolClient } from 'pg';
import type { Actor } from '../shared/authz';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  diff?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function audit(db: PoolClient, actor: Actor, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, diff, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actor.type, actor.id, e.action, e.entity, e.entityId ?? null, e.diff ?? {}, e.ip ?? null, e.userAgent ?? null],
  );
}
```

## 9. Checklist

- [ ] Web session in an `HttpOnly; Secure; SameSite` cookie; logout revokes the session on the server
- [ ] Passwords hashed with argon2id/bcrypt, 15+ characters without MFA; failed logins and OTP sends limited per account and IP
- [ ] Every endpoint checks permissions on the server through one shared function; deny by default
- [ ] Records loaded within the tenant scope before per-record checks; other tenant → 404, missing permission → 403
- [ ] Validation schema blocks mass assignment (`role`, `tenantId`, `ownerId`...)
- [ ] Role × action matrix tests, plus API tests for denied roles; role changes lock owners and keep one
- [ ] API keys hashed, bound to the path tenant, scoped to actions, audited as the key
- [ ] Webhooks verify the signature on the raw body, reject old requests, process idempotently
- [ ] MFA and audit log for admins; audit log append-only (REVOKE); impersonation is limited and logged
