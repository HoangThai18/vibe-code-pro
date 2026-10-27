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
