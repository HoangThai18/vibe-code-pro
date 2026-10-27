# Application security: common holes beyond authentication and authorization

Login, sessions, authorization and webhooks are in `auth.md`; tenant isolation in `multi-tenant.md`. This file covers the other holes that commonly appear while building features. The code ran with Node 22, TypeScript strict, PostgreSQL 16 as the app role (15 tests pass; removing any single guard in `safe-fetch.ts` makes a test fail); both workflows passed actionlint; gitleaks was tested catching a fake key in a sample repo.

## Contents
1. Five questions before building a feature
2. File uploads
3. Server fetching user-supplied URLs (SSRF)
4. Rate limiting
5. Security headers
6. Secrets and dependencies in CI
7. Errors and logs
8. Tenant secrets

## 1. Five questions before building a feature

Answer briefly in the task card (the `vibe-tasks` skill), "Security" section. It takes a few minutes and prevents most of the holes below:

1. What **data** does the feature read or write, and whose? Any personal or sensitive data (`privacy.md`)?
2. **Who** may do it, and where is that checked (tenant, role, record owner)?
3. Where does **input** come from: form, file upload, URL, webhook, another system? Which of it do outsiders control?
4. Does the server **call out** (user-entered URL, third-party API, email/SMS)?
5. If **abused** (called 10,000 times, malicious input, a tenant member trying to see another tenant), what is the damage and what stops it?

## 2. File uploads

```ts
{{src/security/upload.ts}}
```

Tests (executed): real PNG and JPEG accepted; HTML content named `.png`, SVG with `onload`, empty files and oversized files rejected; an image with EXIF has no EXIF after re-encoding; storage keys sit under `tenants/{tenantId}/` and reject a non-uuid tenant and `..`, `//` or absolute folders.

Every object storage key in the app comes from `storageKey` (`references/data-layer.md` section 8, `references/multi-tenant.md` section 4): one format, so per-tenant export, deletion and bucket policies work on one prefix.

When storing and serving files:

- Store in object storage in a **private** bucket; serve via short-lived signed URLs (a few minutes) after the permission check (`data-layer.md`, file storage section).
- Do not serve user uploads from the app's own domain. If it must be the same domain, send the correct `Content-Type`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` for non-image files.
- The original filename is for display only, never a storage path.
- Limit size at both the proxy (e.g. nginx `client_max_body_size`) and the app; limit files per user per day.
- Files from outsiders (customers via a public form) can be virus-scanned in a background job before staff open them.

## 3. Server fetching user-supplied URLs (SSRF)

Link previews, importing data from a URL, sending webhooks to customer URLs: the server sends requests to an address someone else chose. Unblocked, that person can read internal services, admin pages open only on the private network, or the cloud instance metadata (`169.254.169.254`, which includes the machine's temporary credentials).

```bash
npm install undici ipaddr.js
```

```ts
{{src/security/safe-fetch.ts}}
```

Tests (executed, `test/safe-fetch.test.ts`; a local server on 127.0.0.1 is allowed only by overriding `isAllowedAddress` and `ports`):

| Case | Expect |
|---|---|
| `isPublicAddress`: `8.8.8.8`, `1.1.1.1`, `2606:4700:4700::1111` | allowed |
| `127.0.0.1`, `10.0.0.5`, `172.16.5.4`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `::1`, `::`, `fc00::1`, `fe80::1`, `::ffff:127.0.0.1`, `::ffff:10.0.0.1`, `not-an-ip` | blocked |
| URLs `http://127.0.0.1/`, `http://localhost/`, `http://[::1]/`, `http://2130706433/`, `http://0x7f.1/`, `http://169.254.169.254/latest/meta-data/`, `http://[::ffff:169.254.169.254]/`, `http://10.0.0.1/`, `file:///etc/passwd`, `ftp://example.com/`, `http://user:pass@example.com/`, `http://example.com:8080/` | `BlockedUrlError` before connecting |
| A valid page | 200 with the body |
| Redirect to `169.254.169.254` or to `[::1]` | blocked |
| `localhost` (a name, not a literal IP) with the default policy | blocked at connect time by the DNS result check |
| 2 MB body with a 1 MB limit / 3 s response with a 500 ms timeout | `BlockedUrlError` / `TimeoutError` |

- Block by IP address after resolution, not by domain name: domain denylists can always be bypassed (decimal IPs, domains pointing to 127.0.0.1, redirects).
- Fetch URLs in a background job when possible (`jobs.md`), so user requests do not wait on an unknown server.
- Outgoing webhooks: check the URL when the customer saves the config **and** at send time (DNS can change); sign the payload so the receiver can verify it (`auth.md` section 7), with a per-endpoint secret kept sealed (section 8).

## 4. Rate limiting

Apply to: login, password reset, sending OTPs (per IP **and** per account), public endpoints, paid features (AI, SMS), data export.

```sql
{{rate-limits.sql}}
```

```ts
{{src/security/rate-limit.ts}}
```

Test (executed): 50 parallel requests on the same key with a limit of 10 let exactly 10 through.

- Over the limit: return `429` with header `Retry-After: <retryAfterSeconds>` and a dedicated error code, e.g. `rate_limited` (error code table in `api-conventions.md`).
- IP-based keys need the real client IP: behind a proxy/load balancer, configure the app to trust exactly the number of proxies in front, never a client-sent `X-Forwarded-For`.
- For very high request volume, add limits at the proxy/CDN layer too; this table is for business-level limits.

## 5. Security headers

| Header | Suggested value | What it stops |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Non-HTTPS access (the browser always uses HTTPS) |
| `Content-Security-Policy` | Start from `default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, add needed sources | Foreign scripts running in the page (XSS), the page being embedded in an iframe |
| `X-Content-Type-Options` | `nosniff` | The browser guessing a file type and running it by mistake |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Leaking paths containing ids or tokens to other sites |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` (enable what you need) | The page using devices it does not need |

Set them at the proxy or in shared middleware (e.g. `helmet` for Express/Fastify). Try CSP in `Content-Security-Policy-Report-Only` mode before enforcing it. Session cookie: `HttpOnly; Secure; SameSite=Lax` (`auth.md`).

## 6. Secrets and dependencies in CI

```yaml
{{.github/workflows/security.yml}}
```

- gitleaks scans **the full git history**: tested, deleting the file holding a key and committing still gets flagged on the next scan. If a secret leaks, **revoke it and create a new key immediately**; removing it from code is not enough, because the key stays in history and in every clone.
- Add gitleaks as a pre-commit hook on dev machines to block secrets before commit.
- `npm audit` reports known package vulnerabilities; update dependencies regularly with Dependabot or Renovate (the `vibe-ship` skill, `references/maintenance.md`). Python projects use `pip-audit`, Go uses `govulncheck`.
- Enable GitHub secret scanning and Dependabot alerts (free for public repos).

## 7. Errors and logs

- Never return stack traces, SQL or file paths in error responses; return an error code and a `requestId` for log lookup (`api-conventions.md`).
- Never log passwords, tokens, API keys, cookie contents, card numbers, or personal data not needed for investigation (`privacy.md`). Filter in the logger (a list of redacted fields), not at each log call.
- Log security events: repeated failed logins, permission changes, data exports, sensitive data access; keep them long enough to investigate incidents (the `vibe-fix` skill).

## 8. Tenant secrets

Each spa's provider credentials live in your database: VNPay `hashSecret`, MoMo `secretKey`, SePay/Casso API keys, Zalo OA tokens, outgoing webhook secrets. A leaked dump or backup must not hand them out, and they can't be hashed (you need them back to sign requests), so seal them:

- **AES-256-GCM** (encrypts and detects tampering), stored in a `*_sealed bytea` column as `version (1 byte) | iv (12) | tag (16) | ciphertext`. A new random iv for every seal.
- **The key is not in the database**: 32 bytes from a secret manager or KMS (an environment variable in examples). With KMS envelope encryption, KMS keeps the master key and the app decrypts its data key at startup.
- **`key_version` per row** says which key sealed it. Rotation: add key N+1, deploy, re-seal rows on older versions tenant by tenant (`app_tenant_ids()` + `withTenant`, `references/jobs.md`), check as `app_maintenance` that none is left, then remove the old key.
- **Open only where used**: the job that calls the provider or signs the webhook. Never return a secret from the API after creation, never log it, never put it in job payloads (pass ids).
- Every project uses the same `src/security/secret-box.ts`; keep a byte-identical copy rather than writing another.

```ts
{{src/security/secret-box.ts}}
```

Example: outgoing webhook endpoints. `payment_accounts` (`references/payments.md`) and `zalo_tokens` (`references/notifications.md`) seal their credentials the same way.

```sql
{{sql/webhook-endpoints.sql}}
```

```ts
{{src/security/tenant-secrets.ts}}
```

Tests (executed): round trip with Vietnamese text; two seals of one value differ; one changed byte (iv, tag or ciphertext), another key, an unknown version or a 31-byte key throws; the column holds no plaintext; tenant B reads nothing of tenant A's (RLS); rotation re-seals once per row, after which the old key can be removed; a row still on a removed key fails with a clear error.
