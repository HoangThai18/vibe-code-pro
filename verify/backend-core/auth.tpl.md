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
{{src/shared/authz.ts}}
```

- Check permissions in the use case/service layer, which every entry point (HTTP, jobs, CLI) passes through; don't scatter `if (user.role === ...)` across controllers and components.
- Hiding a button in the UI is convenience, not authorization: the API must still block (test both sides: the `vibe-build` skill, `references/e2e-playwright.md` section 6).
- Another tenant's resource → **404** (don't reveal it exists). Resource in the tenant but no permission → **403**.
- Table-driven tests for the role × action matrix, so a new permission is just a new row:

```ts
{{test/authz.test.ts}}
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
{{src/members/change-role.ts}}
```

## 6. API keys for integrations

```sql
{{sql/api-keys.sql}}
```

```ts
{{src/auth/api-keys.ts}}
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
{{src/auth/webhook.ts}}
```

- Process idempotently by event id (a `processed_events` table with UNIQUE): providers resending many times is normal.
- Return 2xx fast and push heavy work to a queue or outbox. Don't trust amounts or statuses in the payload when you can query the provider's API instead.

## 8. Admin accounts, impersonation, audit log

- Enable MFA for owners and every internal admin account.
- The internal admin area is separate from the customer app (routes, permissions, ideally its own domain), and every action writes an audit log.
- Impersonating a customer (support): requires a reason, a time limit and a clear on-screen banner; audit-log both the real person (`impersonator_id`) and the impersonated account; sensitive actions (password change, payments) are blocked.
- Audit log: who, what, which tenant, when, from where (IP, user agent), before and after (for permission and price changes). Written in the same transaction as the change. **Append-only**: the app role can INSERT and SELECT only; retention purges run as `app_maintenance` (`references/postgres-rls.md` section 1).

```sql
{{sql/audit-log.sql}}
```

```ts
{{src/audit/audit.ts}}
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
