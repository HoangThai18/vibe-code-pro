// apps/api/src/imports/rows.ts — header detection, validation of every row, duplicates inside the file
import { CellError, ImportFileError, LIMITS, text, type SheetRow } from './cells';
import { FIELDS, findHeader, type Column } from './columns';
import { CustomerRow, type CustomerInput } from './schema';

export interface RowError { column: string; message: string }
export interface StagedRow { rowNumber: number; data: CustomerInput | null; raw: string[]; errors: RowError[] | null }

export const columnLabel = (columns: Column[], field: string) => {
  const c = columns.find((x) => x.field === field);
  return c ? `${c.header} (${c.letter})` : field;
};

export async function parseRows(rows: AsyncIterable<SheetRow>, maxRows = LIMITS.maxRows) {
  let columns: Column[] | null = null;
  let header: string[] = [];
  const staged: StagedRow[] = [];
  const firstRowOfPhone = new Map<string, number>();
  const firstRowOfEmail = new Map<string, number>();
  for await (const { rowNumber, cells } of rows) {
    if (!columns) {
      if (rowNumber > 20) break;
      columns = findHeader(cells);
      header = cells.map(text);
      continue;
    }
    if (cells.every((c) => text(c) === '' && !(c instanceof CellError))) continue;   // blank row; numbering stays Excel's
    if (staged.length >= maxRows) throw new ImportFileError(`File có hơn ${maxRows} dòng: hãy tách thành nhiều file`);

    const cols = columns;   // only mapped columns are read: an unknown 'tenant_id' column is ignored
    const values = Object.fromEntries(FIELDS.map((f) => [f, cells[cols.find((c) => c.field === f)?.index ?? -1] ?? null]));
    const label = (field: unknown) => columnLabel(cols, String(field));
    const result = CustomerRow.safeParse(values);
    const errors: RowError[] = result.success ? [] : result.error.issues.map((i) => ({ column: label(i.path[0]), message: i.message }));
    if (result.success) {
      const { phone, email } = result.data;
      const samePhone = firstRowOfPhone.get(phone);           // two rows with one phone would hit one customer
      if (samePhone) errors.push({ column: label('phone'), message: `SĐT trùng với dòng ${samePhone}` });
      const sameEmail = email ? firstRowOfEmail.get(email) : undefined;   // UNIQUE (tenant_id, email) would fail the chunk
      if (sameEmail) errors.push({ column: label('email'), message: `Email trùng với dòng ${sameEmail}` });
      if (errors.length === 0) {
        firstRowOfPhone.set(phone, rowNumber);
        if (email) firstRowOfEmail.set(email, rowNumber);
      }
    }
    // raw for every row: a row rejected later (apply) is still reported with its original cells
    staged.push(result.success && errors.length === 0
      ? { rowNumber, data: result.data, raw: cells.map(text), errors: null }
      : { rowNumber, data: null, raw: cells.map(text), errors });
  }
  if (!columns) throw new ImportFileError('Không thấy dòng tiêu đề có cột "Họ tên" và "Số điện thoại" trong 20 dòng đầu');
  return { columns, header, rows: staged };
}
