// Prints formatted values; format.test.ts runs it under several TZ settings and compares the output
import { formatDateOnly, formatDateTime, localDate } from '../../src/i18n/format';

const at = new Date('2026-10-24T08:30:00Z');
console.log(
  [
    formatDateTime(at, { locale: 'vi', timeZone: 'Asia/Ho_Chi_Minh' }),
    formatDateTime(at, { locale: 'en', timeZone: 'Asia/Ho_Chi_Minh' }),
    formatDateOnly('2001-07-18', 'vi'),
    localDate(new Date('2026-10-24T17:00:00Z'), 'Asia/Ho_Chi_Minh'),
  ].join('\n'),
);
