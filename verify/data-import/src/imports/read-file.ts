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
