# Data import from Excel/CSV: validate, preview, apply once

Bring a tenant's existing data (a new spa's 3,000–50,000 customers from Excel or an old program's CSV) in without duplicates, lost leading zeros or swapped day/month. Ran with exceljs 4.4.0, csv-parse 7.0.3, zod 4.6.7, pg-boss 12.38, PostgreSQL 16 (`FORCE` RLS, role without BYPASSRLS): 21 tests on real .xlsx and CSV files; removing any one safeguard (natural key, resume point, `FOR UPDATE`, email checks, formula prefix, fatal decoder, leading-zero restore, day-first parsing) fails one.

**Right-size it.** A few hundred rows can apply inline (no job), CSV UTF-8 only. Never skip the natural key with `ON CONFLICT`, day-first dates, phone normalization, formula escaping in exported CSV.

## Contents
1. Choosing a library
2. Flow and API
3. Example: customers from old software
4. Rules
5. Tests
6. Operations

## 1. Choosing a library

| Format | Use | Verified notes |
|---|---|---|
| CSV | `csv-parse` 7, stream API | Set `delimiter` yourself: `delimiter_auto` split a `;` file on spaces and threw `TypeError` on Vietnamese text (7.0.3) |
| .xlsx | `exceljs` 4.4.0 | `load()` gives cached formula results, repeats a merged cell's value across its range, returns `Date` for date-formatted cells. `columnCount` walks every row (read per row: 432 s for 50,000 rows) |
| .xlsx via SheetJS | only from cdn.sheetjs.com | npm `xlsx` stops at 0.18.5 (2022) with two high advisories `npm audit` cannot fix |
| .xls, password-protected .xlsx | reject | Both are CFB files: ask for .xlsx or CSV UTF-8 |

## 2. Flow and API

Permission `customer.import`, error shape from `references/api-conventions.md`.

1. `POST /v1/t/{tenantId}/imports` (multipart): type from magic bytes (`references/app-security.md` section 2: xlsx mime → xlsx, CFB → "save as .xlsx", other type or NUL byte → reject, none → CSV); SHA-256, same file → the earlier batch; parse, validate every row (zod), stage in `import_rows`; return batch, mapping, first 200 errors. Whole-file problem → 400 `import_file_invalid`.
2. Preview (FE): mapping, counts, errors ("Dòng 9 · SĐT (B) · SĐT không hợp lệ"), skip or update existing customers.
3. `POST .../imports/{id}/confirm` `{ onConflict }`: `previewed`/`failed` → `queued` plus the `import-apply` job, one transaction (`references/jobs.md`). 202; other tenant 404; running or done 409.
4. `GET .../imports/{id}`: status and counts. The FE polls with key `['tenant', tenantId, 'imports', id]` and a `refetchInterval` function (2000 while queued/applying, else `false`; the `vibe-frontend` skill, `references/state-management.md`).
5. `GET .../imports/{id}/errors.csv`: rejected rows, original columns plus "Dòng gốc", "Lỗi"; re-uploadable once fixed.

## 3. Example: customers from old software

```sql
{{sql/import.sql}}
```

```ts
{{src/imports/read-file.ts}}
```

```ts
{{src/imports/cells.ts}}
```

A zod row schema wraps each normalizer: a `CellError` becomes an issue on that field, reported as `{ row, column: 'SĐT (B)', message }`. The apply job (`withTenant`: `references/postgres-rls.md` section 4):

```ts
{{src/imports/apply.ts}}
```

For the error report and every other CSV export (any file users open in Excel):

```ts
{{src/imports/csv-field.ts}}
```

Tested, not shown: header aliases compared without diacritics (`ho ten`, `sdt`, `so dien thoai`, `ngay sinh`...); header = first of 20 rows with name and phone columns; delimiter = whichever of `,` `;` tab splits a line into that header (`;` is common where `,` is the decimal mark, as in vi-VN, and addresses hold commas); queue `retryLimit: 3`, `heartbeatSeconds: 30`.

## 4. Rules

1. **Natural key per tenant** `(tenant_id, phone)`: `DO NOTHING` to skip, `DO UPDATE` with `COALESCE` so empty cells keep stored values. Reject rows without a phone (re-runs would duplicate them) and repeated phones in the file (`DO UPDATE` aborts on a key repeated in one statement).
   **Any other unique key** needs the same care, or one bad row fails its chunk on every retry and the batch never finishes: `ON CONFLICT` handles one key. The example handles `UNIQUE (tenant_id, email)`, which many apps add to `customers`: emails stored lower-case, a repeat in the file and an email another customer has rejected at preview, and in the apply, rows whose email was taken after the preview rejected (the `taken` step: one index lookup per row; drop it if emails are not unique).
2. **Same file = same batch** (hash). **One transaction per 500-row chunk** with its progress, `FOR UPDATE` on the batch; job payload ids only.
3. **Encoding**: decode with the fatal `TextDecoder`; `Buffer.toString` keeps the BOM as `\uFEFF` and the first header stops matching. Invalid UTF-8 (Windows-1258), U+FFFD or `?` inside names: ask for a CSV UTF-8 re-export, never guess the code page.
4. **Limits**: 10 MB (proxy and app), 50,000 rows, 5 s `statement_timeout` (a chunk took ~25 ms). At 50,000 rows: CSV (3.9 MB) parse + validate 0.9 s, +47 MB heap; xlsx (1.3 MB) 2.2 s, +190 MB (`load()` holds it all); parse + staging 2.1 s; apply 2.2 s; a re-export in update mode 4.4 s. Parsing blocks the event loop, and an .xlsx (a zip) inflates far beyond its size: for bigger files parse in the worker under `--max-old-space-size`, streaming CSV from storage through `TextDecoderStream('utf-8', { fatal: true })`.
5. **CSV injection** (OWASP): `csvField` on every exported cell. OWASP warns Excel may lose the escape after save and re-open.
6. **Tenant**: the job runs in `withTenant(job.tenantId)`; the tenant never comes from the file (an unmapped `tenant_id` column is ignored); hashes are per tenant. Rate-limit uploads (`references/app-security.md` section 4).
7. **Personal data** (`references/privacy.md`): parse from memory, keep no file (if stored, delete it with the rows). Applied rows go at the end; a purge job enqueued at upload (`startAfter: 7 * 24 * 3600`) removes the rest, or the unfinished batch. Log ids, counts and row numbers, never cell values. "Ghi chú"/"Tiền sử" may hold health data: restricted table (`references/privacy.md` section 5) or unmapped.

## 5. Tests

Real Postgres as the app role, real pg-boss, run serially:

- **Pitfalls** on real files: merged title, header on row 4, numeric phone, serial `32964` → `1990-04-01`, formulas with and without cached result, multi-line CSV cell, `;` with commas, Windows-1258, .xls.
- **Idempotent**: same file → same batch; re-export in update mode: 1 inserted, 300 updated.
- **Emails** (`UNIQUE (tenant_id, email)`): `CHUNG@` repeating `chung@` and another customer's `Mai@Spa.vn` are rejected at preview, the customer's own email and another spa's are not; an email taken between preview and apply rejects that row (in `errors.csv`) and the batch finishes.
- **Crash**: a trigger fails row 252 → `next_row` 201; rerun → 350 inserted. **SIGKILL** of the worker mid-file → pg-boss retry → 1,500 rows, each once. **Two workers**, one batch: 400 inserted, 0 updated.
- **Isolation**: B's job on A's batch does nothing; B gets 404; B's `tenant_id` under A fails RLS. **Report**: `=HYPERLINK(...)` → `"'=HYPERLINK(...)"`. **Retention**: purge due in 168 h.

## 6. Operations

- `boss.createQueue` ignores an existing queue: use `boss.updateQueue` to change it.
- A `failed` batch keeps its progress; confirming again resumes. Alert on failed `import-apply` jobs and batches stuck in `applying` (the `vibe-ship` skill, `references/observability.md`).
- Visit history: import after customers, match by normalized phone in the tenant, natural key customer + `starts_at`, reject unknown phones.

**Done when**
- [ ] The same file twice, or a re-export, adds no duplicates; a row that breaks another unique key (email) is reported and never stalls the batch.
- [ ] Errors give Excel row, column and a Vietnamese message.
- [ ] Leading zeros kept; dates day-first; non-UTF-8 CSV rejected.
- [ ] A worker killed mid-file resumes with correct counts.
- [ ] Exported CSV escapes formula starters; rows land only in the job's tenant; staged rows purged; no cell values in logs.

Sources: https://owasp.org/www-community/attacks/CSV_Injection · https://github.com/SheetJS/sheetjs (README) · https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 · https://github.com/advisories/GHSA-5pgg-2g8v-p4x9
