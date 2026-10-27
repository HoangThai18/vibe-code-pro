// apps/api/src/imports/schema.ts
import { z } from 'zod';
import { CellError, normalizePhone, parseDate, text, type CellValue } from './cells';

// A CellError thrown by a normalizer (or set by the reader) becomes a zod issue on that field
const cell = <T>(fn: (v: CellValue) => T) =>
  z.custom<CellValue>().transform((v, ctx) => {
    try {
      if (v instanceof CellError) throw v;
      return fn(v);
    } catch (err) {
      if (!(err instanceof CellError)) throw err;
      ctx.addIssue(err.message);
      return z.NEVER;
    }
  });
const VN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });   // reused: toLocaleDateString per row cost 5 s / 50k rows

export const CustomerRow = z.object({
  fullName: cell(text).pipe(z.string().min(1, 'Thiếu họ tên').max(200, 'Họ tên dài quá 200 ký tự')
    .refine((s) => !/[?\uFFFD]/.test(s), 'Họ tên có ký tự lỗi (? hoặc �): lưu file dạng CSV UTF-8 rồi tải lại')),
  phone: cell(normalizePhone),
  birthday: cell(parseDate)
    .refine((d) => d === null || (d >= '1900-01-01' && d <= VN_DATE.format(new Date())), 'Ngày sinh phải từ 1900 đến hôm nay'),
  email: cell((v) => text(v) || null).pipe(z.email('Email không hợp lệ').nullable()),
});
export type CustomerInput = z.output<typeof CustomerRow>;
