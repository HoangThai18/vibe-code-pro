# Authentication, sessions and authorization

Authentication answers "who is this"; authorization answers "what may this person do, on which data". The most common holes in real apps are in the second: checking permissions in the UI but not the API, checking the action type but not the individual record.

The TypeScript in this file was run (strict, Node 22).

## Contents
1. Choosing authentication
2. Login sessions
3. Passwords, OTP, password reset
4. Role-based authorization within a tenant
5. Per-record authorization
6. API keys for integrations
7. Incoming webhooks
8. Admin accounts, impersonation, audit log
9. Checklist

## 1. Choosing authentication

| Option | Fits | Notes |
|---|---|---|
| Managed service (Clerk, Auth0, Supabase Auth, Firebase Auth, Cognito...) | Want speed, need SSO/MFA/social login out of the box | Vendor lock-in, per-user pricing; user data lives with a third party |
| Framework library (Auth.js, Better Auth, Devise, Django auth, Spring Security...) | Want user data in your own DB | You handle operations: rate limits, email, account lockout |
| Build from scratch | Almost never | Never invent your own password hashing, token generation or signature comparison |

If the project already has authentication, keep it. Read the docs for the exact version first (auth libraries change APIs often).

## 2. Login sessions

- Web apps: session in a **`HttpOnly; Secure; SameSite=Lax` cookie**; never keep tokens in `localStorage` (any injected script can read it).
- **Server-side sessions** (sessions table or Redis) can be revoked immediately on logout, password change, account lock. **JWTs** can't be revoked before expiry: use them only with short lifetimes (minutes) plus rotating refresh tokens (each use issues a new token and invalidates the old one; reuse of an old token revokes the whole chain).
- Rotate the session id right after login (prevents session fixation). Logout deletes the session on the server, not just the cookie.
- State-changing requests using cookies: `SameSite=Lax` plus checking that the `Origin` header matches the app's domain; if cross-domain calls must be allowed, use CSRF tokens.
- The tenant comes from the request path and membership is checked on every request; the role is read from that membership (or a short cache), never from a client-sent value (`references/postgres-rls.md` section 4). A role inside a JWT stays stale until the token changes: re-check from the DB for sensitive actions (permission changes, payments, data export).

## 3. Passwords, OTP, password reset

- Hash with **argon2id** (or bcrypt if the platform only has bcrypt), with parameters per the current OWASP Password Storage Cheat Sheet. Never plain MD5/SHA.
- Minimum length 8, allow long ones (64+), block passwords on breached lists; no "must contain a special character" rules, no forced periodic changes (per NIST SP 800-63B).
- Failed login: the same message for "wrong email" and "wrong password"; limit attempts per account **and** per IP, slowing down progressively instead of hard lockout (hard lockout lets attackers lock other people's accounts).
- Password reset: random single-use token, store its **hash** in the DB, expires after 30–60 minutes; same response whether or not the email exists; after reset, revoke all old sessions.
- OTP via SMS/Zalo: 6 digits, expires in a few minutes, cancel the code after ~5 wrong attempts; limit sends per phone number and per IP, add a captcha past a threshold. Without send limits, attackers use you to blast messages and the SMS bill explodes.

## 4. Role-based authorization within a tenant

Roles attach to the **membership** (`memberships(tenant_id, user_id, role)`), not the user: one person can be owner at one spa and staff at another. Permissions live in **one place**, deny by default:

```ts
// shared/authz.ts
export type Role = 'owner' | 'manager' | 'staff';
export type Action =
  | 'customer.read' | 'customer.write'
  | 'appointment.write' | 'appointment.confirm'
  | 'billing.manage' | 'member.invite';

const permissions: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>(['customer.read', 'customer.write', 'appointment.write', 'appointment.confirm', 'billing.manage', 'member.invite']),
  manager: new Set<Action>(['customer.read', 'customer.write', 'appointment.write', 'appointment.confirm']),
  staff: new Set<Action>(['customer.read', 'appointment.write']),   // own appointments only: checked in section 5
};

export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(readonly action: Action) { super(`forbidden: ${action}`); }
}

export function can(role: Role, action: Action): boolean {
  return permissions[role]?.has(action) ?? false;   // unknown role → no permissions
}

// Call at the start of each use case; the HTTP layer maps ForbiddenError → 403
export function authorize(actor: { role: Role }, action: Action): void {
  if (!can(actor.role, action)) throw new ForbiddenError(action);
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
    ['manager', 'appointment.confirm', true],
    ['manager', 'billing.manage', false],
    ['staff', 'customer.read', true],
    ['staff', 'customer.write', false],
    ['staff', 'appointment.write', true],
    ['staff', 'appointment.confirm', false],
  ])('%s %s → %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('a role missing from the table is denied', () => {
    expect(() => authorize({ role: 'intern' as Role }, 'customer.read')).toThrow(ForbiddenError);
  });
});
```

## 5. Per-record authorization

Having `appointment.write` doesn't mean you can edit **every** appointment. Rules like "staff edit only their own appointments" are checked on the specific record, after loading it within the tenant scope:

```ts
// in the updateAppointment use case, after loading appt via a tenant-scoped repository
if (actor.role === 'staff' && appt.staffId !== actor.userId) throw new ForbiddenError('appointment.write');
```

- **IDOR**: every id from the client (path, body, query) is untrusted input. Load the record through the tenant scope (RLS or a tenant-aware repository), then check permissions on that record.
- **Mass assignment**: the validation schema lists exactly the editable fields. `role`, `tenantId`, `ownerId`, `status`, prices never come straight from the body.
- Role changes: the changer must have a role at least as high as the one assigned; a tenant always keeps at least one owner.

## 6. API keys for integrations

- Generate at least 32 random bytes, with a prefix identifying type and environment (e.g. `vk_live_...`); show it **once** at creation.
- The DB stores a hash (SHA-256 is enough for long random keys), plus `tenant_id`, scopes, `expires_at`, `last_used_at`, `revoked_at`.
- Keys are bound to a tenant and minimal scopes; allow several active keys for zero-downtime rotation.

## 7. Incoming webhooks

Payment gateways, Zalo OA and email services call into the system: anyone can send requests to that URL, so verify the signature.

- Use the signature verification function from the provider's official SDK if there is one; every provider has its own signature format, so read their docs.
- If verifying yourself: HMAC over the **raw body** (before JSON parsing), compare with a timing-safe function, reject old requests to block replays:

```ts
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
- Impersonating a customer (support): requires a reason, a time limit and a clear on-screen banner; audit-log both the real person and the impersonated account; sensitive actions (password change, payments) are blocked.
- Audit log: who, what, which tenant, when, from where (IP, user agent), before and after (for permission and price changes). Append-only, never edited; kept per the retention policy.

## 9. Checklist

- [ ] Session in an `HttpOnly; Secure; SameSite` cookie; logout revokes the session on the server
- [ ] Passwords hashed with argon2id/bcrypt; failed logins and OTP sends limited per account and IP
- [ ] Every endpoint checks permissions on the server through one shared function; deny by default
- [ ] Records loaded within the tenant scope before per-record checks; other tenant → 404, missing permission → 403
- [ ] Validation schema blocks mass assignment (`role`, `tenantId`, `ownerId`...)
- [ ] Role × action matrix tests, plus API tests for denied roles
- [ ] Webhooks verify the signature on the raw body, reject old requests, process idempotently
- [ ] MFA and audit log for admins; impersonation is limited and logged
