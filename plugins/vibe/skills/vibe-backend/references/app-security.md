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
// apps/api/src/security/upload.ts
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export class UploadRejectedError extends Error {}

// Allowlist, not denylist. No SVG or HTML: browsers can run scripts inside them
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export async function checkUpload(data: Uint8Array, maxBytes = 5 * 1024 * 1024) {
  if (data.byteLength === 0 || data.byteLength > maxBytes) throw new UploadRejectedError('Kích thước file không hợp lệ');
  // Read the content's magic bytes; never trust the file extension or the browser-sent Content-Type
  const type = await fileTypeFromBuffer(data);
  const ext = type ? ALLOWED.get(type.mime) : undefined;
  if (!type || !ext) throw new UploadRejectedError('Định dạng file không được phép');
  return { mime: type.mime, ext };
}

// Images: re-encode to strip metadata (EXIF can hold the GPS location where the photo was taken) and to block "bomb" images that decompress to a huge size
export async function normalizeImage(data: Uint8Array): Promise<Buffer> {
  return sharp(data, { limitInputPixels: 40_000_000 })
    .rotate()                                                  // rotate per EXIF before EXIF is dropped
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();                                               // sharp does not copy metadata to the new file by default
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The one place that builds object storage keys: tenants/{tenantId}/{folder}/{uuid}.{ext}, e.g. folder 'customers/<id>'.
// Server-generated; the original filename is stored only in the DB, for display
export function storageKey(tenantId: string, folder: string, ext: string): string {
  if (!UUID.test(tenantId) || !/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(folder)) throw new Error('storageKey: bad tenant id or folder');
  return `tenants/${tenantId}/${folder}/${randomUUID()}.${ext}`;
}
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
// apps/api/src/security/safe-fetch.ts
// Fetch user-supplied URLs (link previews, URL imports, customer webhooks) without reaching the internal network
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

export class BlockedUrlError extends Error {}

// Public addresses only: blocks loopback, private networks, link-local (169.254.169.254 is cloud metadata), CGNAT, internal IPv6,
// and IPv4 written as IPv6 (::ffff:127.0.0.1)
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

// Check every address DNS returns, and connect using exactly the checked result: a domain cannot return a public IP at check time
// and an internal IP at connect time (DNS rebinding)
function guardedLookup(isAllowed: (ip: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      if (addresses.length === 0 || addresses.some((a) => !isAllowed(a.address))) {
        return callback(new BlockedUrlError(`Không cho phép tải từ ${hostname}`), '', 0);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  ports?: string[];                               // '' is the http/https default port
  isAllowedAddress?: (ip: string) => boolean;     // override only in tests
}

export async function safeFetchText(input: string, opts: SafeFetchOptions = {}) {
  const { maxBytes = 1_000_000, timeoutMs = 5_000, maxRedirects = 3, ports = ['', '80', '443'], isAllowedAddress = isPublicAddress } = opts;
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(isAllowedAddress) } });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let url = new URL(input);   // URL normalizes: http://2130706433/ and http://0x7f.1/ become http://127.0.0.1/
    for (let redirects = 0; ; redirects++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Chỉ cho phép http và https');
      if (url.username || url.password) throw new BlockedUrlError('Không cho phép URL có tên đăng nhập');
      if (!ports.includes(url.port)) throw new BlockedUrlError(`Không cho phép cổng ${url.port}`);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      // A literal IP in the URL skips DNS lookup, so it must be checked here
      if (net.isIP(host) && !isAllowedAddress(host)) throw new BlockedUrlError(`Không cho phép tải từ ${host}`);

      const res = await fetch(url, { dispatcher, signal, redirect: 'manual' }).catch((err: unknown) => {
        // fetch wraps connection errors in TypeError('fetch failed'); rethrow our block error if it was the cause
        throw err instanceof TypeError && err.cause instanceof BlockedUrlError ? err.cause : err;
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (redirects >= maxRedirects) throw new BlockedUrlError('Quá nhiều lần chuyển hướng');
        url = new URL(location, url);   // the new URL goes through every check again
        continue;
      }
      return { url: url.href, status: res.status, contentType: res.headers.get('content-type') ?? '', body: await readLimited(res.body, maxBytes) };
    }
  } finally {
    await dispatcher.close();
  }
}

async function readLimited(body: AsyncIterable<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new BlockedUrlError(`Nội dung lớn hơn ${maxBytes} byte`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
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
-- UNLOGGED: faster, loses data if Postgres crashes (fine for counters); a job purges old rows hourly
CREATE UNLOGGED TABLE rate_limits (
  key          text        NOT NULL,   -- e.g. 'login:ip:1.2.3.4', 'ai:user:<uuid>'
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  PRIMARY KEY (key, window_start)
);
-- Purge: DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
```

```ts
// apps/api/src/security/rate-limit.ts
import type { Pool, PoolClient } from 'pg';

// Fixed window counted in Postgres: correct across multiple app instances, no extra Redis needed
export async function hitRateLimit(db: Pool | PoolClient, key: string, limit: number, windowSeconds: number) {
  const { rows } = await db.query<{ count: number; retry_after: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count, ceil(extract(epoch FROM window_start + make_interval(secs => $2) - now()))::int AS retry_after`,
    [key, windowSeconds],
  );
  const row = rows[0]!;
  return { allowed: row.count <= limit, retryAfterSeconds: Math.max(1, row.retry_after) };
}
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
# .github/workflows/security.yml — runs on every PR and weekly
name: Security
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "0 1 * * 1"   # 08:00 Monday Vietnam time: vulnerabilities published during the week
permissions:
  contents: read
jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0               # scan the full history: secrets deleted from code are still in git
      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"
      - name: Cài gitleaks
        run: go install github.com/zricethezav/gitleaks/v8@v8.30.1
      - name: Quét secret (fail nếu tìm thấy)
        run: '"$(go env GOPATH)/bin/gitleaks" git . --no-banner --redact'
  dependencies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Lỗ hổng mức high trở lên trong dependency chạy ở production
        run: npm audit --omit=dev --audit-level=high
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
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Tenant secrets at rest (provider keys, OAuth tokens): AES-256-GCM, stored in a *_sealed bytea column as
// version (1 byte) | iv (12) | tag (16) | ciphertext. The 32-byte key comes from a secret manager or KMS
// (an environment variable in examples), never from the database: a database dump alone reveals nothing.
const VERSION = 1;

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('secret-box: the key must be 32 bytes');
}

export function sealSecret(plaintext: string, key: Buffer): Buffer {
  checkKey(key);
  const iv = randomBytes(12); // never reuse an iv with the same key
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

// Throws if the value was changed, sealed with another key, or is not in this format
export function openSecret(sealed: Buffer, key: Buffer): string {
  checkKey(key);
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new Error('secret-box: unknown format');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString('utf8');
}
```

Example: outgoing webhook endpoints. `payment_accounts` (`references/payments.md`) and `zalo_tokens` (`references/notifications.md`) seal their credentials the same way.

```sql
-- Outgoing webhooks: the customer's URL and the secret we sign payloads with (auth.md section 7)
CREATE TABLE webhook_endpoints (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  url           text NOT NULL,                   -- checked as in section 3 on save and on every send
  secret_sealed bytea NOT NULL,                  -- sealSecret(signing secret, key)
  key_version   smallint NOT NULL,               -- which key sealed it; rotation re-seals older versions
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_endpoints
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```ts
// apps/api/src/security/tenant-secrets.ts — inside withTenant / withMember
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { openSecret, sealSecret } from './secret-box';

// SECRET_BOX_KEYS from the secret manager, e.g. '{"1":"<base64 of 32 random bytes>","2":"..."}'.
// The highest version seals new values; older ones stay loaded until every row is re-sealed.
export interface KeyRing { current: number; keys: ReadonlyMap<number, Buffer> }

export function loadKeyRing(json: string): KeyRing {
  const keys = new Map(Object.entries(JSON.parse(json) as Record<string, string>)
    .map(([version, b64]) => [Number(version), Buffer.from(b64, 'base64')] as const));
  if (keys.size === 0) throw new Error('SECRET_BOX_KEYS is empty');
  return { current: Math.max(...keys.keys()), keys };
}

function keyFor(ring: KeyRing, version: number): Buffer {
  const key = ring.keys.get(version);
  if (!key) throw new Error(`secret key version ${version} is not loaded`);
  return key;
}

// Check the URL first (section 3). Returns the secret once, for the customer's receiver.
export async function createWebhookEndpoint(db: PoolClient, ring: KeyRing, url: string) {
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO webhook_endpoints (url, secret_sealed, key_version) VALUES ($1, $2, $3) RETURNING id',
    [url, sealSecret(secret, keyFor(ring, ring.current)), ring.current],
  );
  return { id: rows[0]!.id, secret };
}

// Opened only in the job that signs and sends; never logged, never returned by the API again
export async function webhookSecret(db: PoolClient, ring: KeyRing, endpointId: string): Promise<string | null> {
  const { rows } = await db.query<{ secret_sealed: Buffer; key_version: number }>(
    'SELECT secret_sealed, key_version FROM webhook_endpoints WHERE id = $1', [endpointId]);
  return rows[0] ? openSecret(rows[0].secret_sealed, keyFor(ring, rows[0].key_version)) : null;
}

// Key rotation: re-seal the rows still on an older key, tenant by tenant
export async function resealWebhookSecrets(db: PoolClient, ring: KeyRing): Promise<number> {
  const { rows } = await db.query<{ id: string; secret_sealed: Buffer; key_version: number }>(
    'SELECT id, secret_sealed, key_version FROM webhook_endpoints WHERE key_version < $1 FOR UPDATE', [ring.current]);
  for (const r of rows) {
    const plain = openSecret(r.secret_sealed, keyFor(ring, r.key_version));
    await db.query('UPDATE webhook_endpoints SET secret_sealed = $2, key_version = $3 WHERE id = $1',
      [r.id, sealSecret(plain, keyFor(ring, ring.current)), ring.current]);
  }
  return rows.length;
}
```

Tests (executed): round trip with Vietnamese text; two seals of one value differ; one changed byte (iv, tag or ciphertext), another key, an unknown version or a 31-byte key throws; the column holds no plaintext; tenant B reads nothing of tenant A's (RLS); rotation re-seals once per row, after which the old key can be removed; a row still on a removed key fails with a clear error.
