// apps/api/src/imports/report.ts
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import { csvField } from './csv-field';
import type { RowError } from './rows';

// GET /v1/t/{tenantId}/imports/{id}/errors.csv: rejected rows with the original columns (same letters as the
// uploaded file) plus "Dòng gốc" and "Lỗi". The user fixes them in Excel and uploads this file again.
export async function errorReportCsv(pool: Pool, tenantId: string, batchId: string): Promise<string | null> {
  return withTenant(pool, tenantId, async (db) => {
    const { rows: [batch] } = await db.query<{ header: string[] }>('SELECT header FROM import_batches WHERE id = $1', [batchId]);
    if (!batch) return null;                                                            // 404
    const { rows } = await db.query<{ row_number: number; raw: string[]; errors: RowError[] }>(
      'SELECT row_number, raw, errors FROM import_rows WHERE batch_id = $1 AND errors IS NOT NULL ORDER BY row_number',
      [batchId]);
    const width = Math.max(batch.header.length, ...rows.map((r) => r.raw.length));
    const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? '');
    const lines = [[...pad(batch.header), 'Dòng gốc', 'Lỗi'],
      ...rows.map((r) => [...pad(r.raw), String(r.row_number), r.errors.map((e) => `${e.column}: ${e.message}`).join('; ')])];
    // BOM + CRLF: Excel opens UTF-8 Vietnamese text correctly
    return '\uFEFF' + lines.map((cells) => cells.map(csvField).join(',')).join('\r\n') + '\r\n';
  });
}
