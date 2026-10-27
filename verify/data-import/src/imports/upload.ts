// apps/api/src/imports/upload.ts — the checkUpload pattern of references/app-security.md section 2, for spreadsheets
import { fileTypeFromBuffer } from 'file-type';
import { ImportFileError, LIMITS } from './cells';
import { REEXPORT } from './read-file';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Type from the content (magic bytes), never from the file name or the browser's Content-Type
export async function detectFormat(data: Uint8Array): Promise<'xlsx' | 'csv'> {
  if (data.byteLength === 0 || data.byteLength > LIMITS.maxBytes) throw new ImportFileError('File rỗng hoặc lớn hơn 10 MB');
  const type = await fileTypeFromBuffer(data);
  if (type?.mime === XLSX) return 'xlsx';
  if (type?.ext === 'cfb') throw new ImportFileError(`File .xls (Excel 97-2003) hoặc file có mật khẩu. ${REEXPORT}`);
  if (type || data.includes(0)) throw new ImportFileError('Chỉ nhận file .xlsx hoặc .csv');
  return 'csv';                                          // plain text has no magic bytes
}
