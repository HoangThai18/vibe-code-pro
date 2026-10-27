// Test infrastructure (not part of the doc): fresh schema, pools, xlsx builder
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import pg from 'pg';

export const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://vibe_test:vibe@localhost:5432/import_check';
// The app connects as app_user (NOSUPERUSER NOBYPASSRLS). app_user already exists cluster-wide, so the test
// connects as the admin and switches role for the whole session: RLS and privileges are app_user's.
export const APP_URL = `${ADMIN_URL}?options=${encodeURIComponent('-c role=app_user')}`;
export const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

export function resetDb(): void {
  const psql = (file: string) => execFileSync('psql', [ADMIN_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'pipe' });
  psql(new URL('./base-schema.sql', import.meta.url).pathname);
  psql(new URL('../sql/import.sql', import.meta.url).pathname);
  psql(new URL('../sql/import-rls.sql', import.meta.url).pathname);
  execFileSync('psql', [ADMIN_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON import_batches, import_rows TO app_user'], { stdio: 'pipe' });
}

export const appPool = () => new pg.Pool({ connectionString: APP_URL, max: 6 });
export const adminPool = () => new pg.Pool({ connectionString: ADMIN_URL, max: 2 });

export async function xlsx(build: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet('Khách hàng'));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export function csv(lines: string[], { bom = true, delimiter = ',' } = {}): Uint8Array {
  const body = lines.map((l) => l.replaceAll('|', delimiter)).join('\r\n') + '\r\n';
  return new TextEncoder().encode((bom ? '\uFEFF' : '') + body);
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 100));
  }
}
