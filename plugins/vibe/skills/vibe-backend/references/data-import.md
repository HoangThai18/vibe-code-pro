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
-- Natural key. Live table: CONCURRENTLY, outside a transaction; fails if duplicates already exist
CREATE UNIQUE INDEX CONCURRENTLY customers_tenant_phone ON customers (tenant_id, phone);

CREATE TABLE import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  kind        text NOT NULL CHECK (kind IN ('customers')),
  file_sha256 text NOT NULL,
  file_name   text NOT NULL,                       -- display only
  header      jsonb NOT NULL,                      -- header cells, reused by the error report
  status      text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'queued', 'applying', 'done', 'failed')),
  on_conflict text NOT NULL DEFAULT 'skip' CHECK (on_conflict IN ('skip', 'update')),
  total_rows  int  NOT NULL,
  valid_rows  int  NOT NULL,
  next_row    int  NOT NULL DEFAULT 0,             -- resume point: last Excel row applied
  inserted    int  NOT NULL DEFAULT 0,
  updated     int  NOT NULL DEFAULT 0,
  skipped     int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, kind, file_sha256),           -- the same file twice = the same batch
  UNIQUE (tenant_id, id)
);

-- Parsed rows between preview and apply: personal data, purged (apply.ts, purgeBatch)
CREATE TABLE import_rows (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant(),
  batch_id   uuid NOT NULL,
  row_number int  NOT NULL,                        -- as the user sees it in Excel
  data       jsonb,                                -- normalized values; NULL when rejected
  raw        jsonb,                                -- original cells, for the error report
  errors     jsonb,                                -- [{ "column": "SĐT (B)", "message": "..." }]
  PRIMARY KEY (batch_id, row_number),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batches (tenant_id, id) ON DELETE CASCADE
);

-- Same migration: ENABLE + FORCE RLS and the tenant_isolation policy on both tables (references/postgres-rls.md section 2)
```

```ts
// apps/api/src/imports/read-file.ts
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { fromExcel, ImportFileError, LIMITS, type SheetRow } from './cells';
import { detectDelimiter } from './columns';

export const REEXPORT = 'Mở bằng Excel, chọn Lưu thành (Save As) kiểu CSV UTF-8 hoặc .xlsx rồi tải lại.';

export async function* readCsv(data: Uint8Array): AsyncGenerator<SheetRow> {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(data);   // also drops the BOM
  } catch {
    throw new ImportFileError(`File không phải UTF-8. ${REEXPORT}`);    // Windows-1258 etc.: never guess
  }
  if (content.includes('\uFFFD')) throw new ImportFileError(`File có ký tự lỗi �, đã hỏng mã chữ từ trước. ${REEXPORT}`);
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const chunks = function* () { for (let i = 0; i < bytes.length; i += 65_536) yield bytes.subarray(i, i + 65_536); };
  const parser = Readable.from(chunks()).pipe(parse({
    bom: true, delimiter: detectDelimiter(content), relax_column_count: true, relax_quotes: true, max_record_size: 100_000,
  }));
  let rowNumber = 0;                                     // one record = one Excel row, even with a line break inside quotes
  for await (const record of parser as AsyncIterable<string[]>) yield { rowNumber: ++rowNumber, cells: record };
}

export async function* readXlsx(data: Uint8Array): AsyncGenerator<SheetRow> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data.slice().buffer);   // its types want an ArrayBuffer
  } catch {
    throw new ImportFileError(`Không đọc được file .xlsx. ${REEXPORT}`);
  }
  const ws = wb.worksheets.find((w) => w.state === 'visible');
  if (!ws) throw new ImportFileError('File không có sheet nào');
  if (ws.rowCount > LIMITS.maxRows + 20) throw new ImportFileError(`File có hơn ${LIMITS.maxRows} dòng: hãy tách thành nhiều file`);
  const width = ws.columnCount;                          // walks every row on each read: read it once
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);                            // r is the row number Excel shows
    yield { rowNumber: r, cells: Array.from({ length: width }, (_, c) => fromExcel(row.getCell(c + 1).value)) };
  }
}
```

```ts
// apps/api/src/imports/cells.ts
import type { CellValue as ExcelValue } from 'exceljs';

export const LIMITS = { maxBytes: 10 * 1024 * 1024, maxRows: 50_000 };
export class ImportFileError extends Error {}   // whole-file problem: 400, nothing is staged
export class CellError extends Error {}         // one cell: shown next to its row and column

export type CellValue = string | number | boolean | Date | CellError | null;
export interface SheetRow { rowNumber: number; cells: CellValue[] }   // cells[0] = column A

// exceljs value -> plain value. Formula: the result Excel cached on save; rich text: joined runs
export function fromExcel(v: ExcelValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || v instanceof Date) return v;
  if ('richText' in v) return v.richText.map((run) => run.text).join('');
  if ('formula' in v || 'sharedFormula' in v) {
    return v.result === undefined
      ? new CellError('Ô công thức chưa có kết quả: mở file bằng Excel, lưu lại rồi tải lên')
      : fromExcel(v.result);
  }
  if ('hyperlink' in v) return v.text;
  if ('error' in v) return new CellError(`Ô bị lỗi ${v.error}`);
  return null;
}

// NFC: decomposed text (some keyboards, converters) looks identical but compares differently.
// A ' before a formula starter is our error report's escape (csv-field.ts): drop it on re-import.
export function text(v: CellValue): string {
  if (v === null || v instanceof CellError) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).normalize('NFC').replace(/\s+/g, ' ').trim().replace(/^'(?=[=+\-@＝＋－＠])/, '');
}

export function normalizePhone(v: CellValue): string {
  const s = text(v);                                   // a number cell 912345678 lost its leading 0
  if (s === '') throw new CellError('Thiếu SĐT');
  if (/\d[.,]?\d*e\+?\d+$/i.test(s)) throw new CellError('SĐT bị Excel đổi sang dạng 9,12E+08: định dạng cột SĐT là Text rồi xuất lại');
  let d = s.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+84')) d = `0${d.slice(3)}`;
  else if (/^84\d{9,10}$/.test(d)) d = `0${d.slice(2)}`;
  else if (/^[1-9]\d{8,9}$/.test(d)) d = `0${d}`;
  if (!/^0\d{9,10}$/.test(d)) throw new CellError('SĐT không hợp lệ (ví dụ 0912345678)');
  return d;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);          // Excel serial = days since this date (from March 1900)

// 'YYYY-MM-DD' or null. Never new Date('03/04/2025'): JavaScript reads it as 4 March (US order)
export function parseDate(v: CellValue): string | null {
  if (v instanceof CellError) throw v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);          // date-formatted cell: UTC midnight
  const s = text(v);
  if (s === '') return null;
  const serial = typeof v === 'number' ? v : /^\d{5}$/.test(s) ? Number(s) : NaN;   // General-format cell
  if (serial >= 10_000 && serial < 2_958_466) {                       // 1927..9999; a bare 1990 is a year
    return new Date(EXCEL_EPOCH + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);             // Vietnamese order: day/month/year
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  throw new CellError('Ngày không hợp lệ: dùng dạng dd/mm/yyyy, ví dụ 03/04/1990');
}

function ymd(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new CellError('Ngày không tồn tại (ví dụ 31/02)');
  return d.toISOString().slice(0, 10);
}
```

A zod row schema wraps each normalizer: a `CellError` becomes an issue on that field, reported as `{ row, column: 'SĐT (B)', message }`. The apply job (`withTenant`: `references/postgres-rls.md` section 4):

```ts
// apps/api/src/imports/apply.ts — the import-apply job
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import type { ImportJob, OnConflict } from './service';

const upsertSql = (onConflict: OnConflict) => `
  WITH chunk AS (
    SELECT row_number, data FROM import_rows
     WHERE batch_id = $1 AND row_number > $2 AND data IS NOT NULL
     ORDER BY row_number LIMIT $3
  ), taken AS (           -- email given to another customer after the preview: reject the row, never stall.
    SELECT ch.row_number   -- LATERAL ... LIMIT 1: one lookup in UNIQUE (tenant_id, email) per row, not a scan
      FROM chunk ch CROSS JOIN LATERAL (SELECT phone FROM customers WHERE email = ch.data->>'email' LIMIT 1) c
     WHERE c.phone <> ch.data->>'phone'
  ), written AS (
    INSERT INTO customers (full_name, phone, birthday, email)
    SELECT data->>'fullName', data->>'phone', (data->>'birthday')::date, data->>'email' FROM chunk
     WHERE row_number NOT IN (SELECT row_number FROM taken)
    ON CONFLICT (tenant_id, phone) DO ${onConflict === 'update'
      ? `UPDATE SET full_name = EXCLUDED.full_name,
                    birthday = COALESCE(EXCLUDED.birthday, customers.birthday),
                    email = COALESCE(EXCLUDED.email, customers.email)`
      : 'NOTHING'}
    RETURNING xmax = 0 AS inserted              -- 0: a new row, not an update
  ), rejected AS (        -- reported in errors.csv like any rejected row
    UPDATE import_rows SET data = NULL,
           errors = jsonb_build_array(jsonb_build_object('column', 'Email', 'message', 'Email đã có ở khách hàng khác'))
     WHERE batch_id = $1 AND row_number IN (SELECT row_number FROM taken)
    RETURNING 1
  )
  SELECT (SELECT max(row_number) FROM chunk) AS last_row,
         (SELECT count(*) FROM chunk)::int AS total,
         (SELECT count(*) FROM written WHERE inserted)::int AS inserted,
         (SELECT count(*) FROM written WHERE NOT inserted)::int AS updated,
         (SELECT count(*) FROM rejected)::int AS rejected`;

// One chunk = one transaction with its progress: after a crash, a retry or beside a second worker
// (FOR UPDATE waits), work resumes after next_row and no row counts twice
export async function applyBatch(pool: Pool, job: ImportJob, chunkSize = 500): Promise<void> {
  for (let finished = false; !finished; ) {
    finished = await withTenant(pool, job.tenantId, async (db) => {
      const { rows: [b] } = await db.query<{ status: string; on_conflict: OnConflict; next_row: number }>(
        'SELECT status, on_conflict, next_row FROM import_batches WHERE id = $1 FOR UPDATE', [job.batchId]);
      if (!b || (b.status !== 'queued' && b.status !== 'applying')) return true;   // other tenant (RLS), done, not confirmed
      const { rows: [r] } = await db.query<{ last_row: number | null; total: number; inserted: number; updated: number; rejected: number }>(
        upsertSql(b.on_conflict), [job.batchId, b.next_row, chunkSize]);
      if (!r || r.last_row === null) {
        await db.query("UPDATE import_batches SET status = 'done', finished_at = now() WHERE id = $1", [job.batchId]);
        await db.query('DELETE FROM import_rows WHERE batch_id = $1 AND errors IS NULL', [job.batchId]);   // keep rejected rows only
        return true;
      }
      await db.query(
        `UPDATE import_batches SET status = 'applying', next_row = $2, inserted = inserted + $3, updated = updated + $4,
                skipped = skipped + $5, valid_rows = valid_rows - $6 WHERE id = $1`,
        [job.batchId, r.last_row, r.inserted, r.updated, r.total - r.inserted - r.updated - r.rejected, r.rejected]);
      return false;
    });
  }
}
```

For the error report and every other CSV export (any file users open in Excel):

```ts
// apps/api/src/imports/csv-field.ts — use for the error report and every other CSV export
// OWASP CSV injection: a spreadsheet runs a cell starting with one of these as a formula
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;

// Quote every field, double inner quotes, prefix ' to formula starters
export function csvField(value: string): string {
  return `"${(FORMULA_START.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}
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
