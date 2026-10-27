# Review checklist

A reminder, not a form to fill. Report only real issues in the diff, each with `file:line`, a failure scenario (input or state → consequence) and a short fix.

## Meets requirements
- Does what the acceptance criteria say; doesn't spread beyond the task scope.
- Edge cases: empty, null, duplicates, limits, Vietnamese characters and emoji, time zones, negative or zero numbers, very long lists.

## Design and consistency with the codebase
- Follows the existing conventions of similar modules (file structure, naming, error reporting, validation, tests); no second way to do the same thing.
- Business logic in the business layer, not spread across controllers, components or SQL; no reverse or circular imports; no direct reads of another module's tables.
- No copies of existing logic or helpers; no new dependency without need.
- No premature abstraction (interface, factory, generics for something with one use), and no function or service doing too many jobs.

## Security
- New endpoints are authenticated; authorization checks the resource being accessed, not just "logged in".
- IDOR: access by id checks the resource belongs to the current tenant/user.
- Mass assignment: never bind the body straight to the model (`role`, `tenantId`, `ownerId`, `price`, `status`...).
- Input validated at the edge with a schema; parameterized queries, no SQL string concatenation; no eval/exec of user data.
- No secrets in code, logs or responses; no stack traces returned to the client.
- Uploads: type and size checked; stored file names not chosen by the user; uploads never served as HTML on the same domain.
- Webhooks: signature verified. Server fetching user-supplied URLs: SSRF protection. Redirects from parameters: open-redirect protection.
- Login, OTP, public endpoints and costly features are rate-limited; return 429 with `Retry-After` (the `vibe-backend` skill, `references/app-security.md`).
- CI scans for secrets (including git history) and dependency vulnerabilities; leaked secrets have been revoked, not just removed from code.

## Personal data
- New personal-data fields are in `docs/privacy/DATA-MAP.md`: purpose, storage location, who can view, retention.
- Sensitive data (health, location, financial, children) readable only by roles that need it; never in logs, analytics, email.
- Consent collected per purpose, never pre-checked; messaging jobs filter by current consent at send time.
- New external services receiving personal data are added to the processor list (the `vibe-backend` skill, `references/privacy.md`).

## Tenant isolation
- Every query on a tenant table runs in tenant context (repository layer / RLS); `tenantId` is never taken from the client.
- New tables: `tenant_id NOT NULL`, composite FKs, unique constraints and indexes include `tenant_id`, RLS + `FORCE` + policy in the same migration.
- `FOR ALL` policies have no `OR` branch (an `OR` branch also opens update/delete); broader reads get a separate `FOR SELECT` policy.
- New jobs, cache keys, storage paths and search indexes all carry `tenant_id`.
- New endpoints have tenant isolation tests, run as the app role.

## Data and migrations
- Migration runs on a DB that already has data; has `lock_timeout`; doesn't lock large tables for long (`CREATE INDEX CONCURRENTLY`, `NOT VALID` then `VALIDATE`); has a way back.
- Backfills on `FORCE` tables run as the maintenance role (BYPASSRLS) or per tenant, checking affected row counts; dropping the old column runs only after that check.
- Important invariants are enforced by DB constraints (NOT NULL, FK, UNIQUE, CHECK), not only in code.
- Multi-table writes use a transaction. External side effects (mail, payment, webhook) never run inside a DB transaction and are idempotent.
- Money is an integer + currency code; times stored in UTC.

## Error handling and observability
- No swallowed errors (empty catch, log and ignore); returned errors have a clear `code` for the FE.
- Logs include `requestId` and `tenantId`, never personal data or secrets.
- Third-party calls have timeouts; retries are bounded with backoff.

## Performance
- Speed-up changes have before and after measurements (same scenario), not just "feels faster".
- No N+1 (queries in a loop); lists are paginated with a maximum `limit`.
- New filters/sorts have a matching index (starting with `tenant_id`).
- No loading whole tables into memory; no external API calls in a loop when a batch endpoint exists.

## Frontend
- Matches the design: tokens, spacing, all states (loading / empty / error / disabled).
- Keyboard and focus, input labels, AA contrast, `prefers-reduced-motion`.
- No secrets in the client bundle; no tokens or sensitive data in localStorage when the project has a safer option (httpOnly cookie).
- API errors shown in the right place (per field) and in words users understand.

## Mobile and desktop apps
- Tokens in Keychain/Keystore or `safeStorage`, not AsyncStorage, localStorage or text files; no server secrets in the app.
- API changes stay compatible with still-supported app versions (the `vibe-backend` skill, `references/api-conventions.md` section 8); the app sends a version header.
- Logout clears tokens, cache and local data, and unregisters the device from push.
- Electron: `contextIsolation` and `sandbox` on; preload exposes only specific functions; IPC checks sender and arguments; navigation and new windows blocked (the `vibe-desktop` skill, `references/security.md` section 7). Tauri: capabilities grant only needed permissions.
- System permissions (camera, location...) requested at the right moment with an explanation; the app still works when denied.
- Native code changes are never shipped via OTA.

## AI features
- API keys only on the server; data put in prompts is scoped to the current tenant; system prompts contain no user data.
- Data entered by others goes in JSON or clearly marked tags; tools the model can call use the current user's permissions; consequential actions need a human click to confirm.
- Output validated with a schema and rendered as text; `max_tokens` set, per-tenant budget, usage logged; errors and `refusal` get a friendly message.
- Prompt, model or effort changes: the PR includes eval results (cases passed, cost) (the `vibe-ai` skill, `references/testing.md`).

## Tests
- Tests check real behavior with meaningful asserts; never mock the thing under test.
- Bug fixes have a test reproducing the bug (fails before the fix, passes after).
- Tests don't depend on run order, real time or external networks.
- Tenant isolation and authorization tests are not skipped.
- No weakened tests: the diff doesn't delete, skip (`.skip`, `xit`, `@pytest.mark.skip`) or loosen tests or assertions, change expected values or snapshots just to match new output, or exclude files from test, coverage or lint config. A changed expectation needs a reason tied to the requirement.
