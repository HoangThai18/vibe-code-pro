// test/cells.test.ts — node --import tsx --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CellError, normalizePhone, parseDate, text } from '../src/imports/cells';
import { detectDelimiter } from '../src/imports/columns';
import { csvField } from '../src/imports/csv-field';

test('phone: leading zero restored, +84/84, spaces and dots', () => {
  for (const [input, want] of [
    [912345678, '0912345678'], ['912345678', '0912345678'], ['845123456', '0845123456'],
    ['+84 912 345 678', '0912345678'], ['84912345678', '0912345678'], ['0912.345.678', '0912345678'],
    ['(091) 234-5678', '0912345678'], [2438123456, '02438123456'],
  ] as const) assert.equal(normalizePhone(input), want, String(input));
  assert.throws(() => normalizePhone('9.12346E+08'), /dạng 9,12E\+08/);
  assert.throws(() => normalizePhone('12345'), /SĐT không hợp lệ/);
  assert.throws(() => normalizePhone(null), /Thiếu SĐT/);
});

test('dates: dd/mm/yyyy (Vietnamese order), serials, Date cells; never US order', () => {
  assert.equal(new Date('03/04/2025').getMonth(), 2);            // the trap: JavaScript reads it as March
  assert.equal(parseDate('03/04/2025'), '2025-04-03');
  assert.equal(parseDate('3.4.2025'), '2025-04-03');
  assert.equal(parseDate('2025-04-03'), '2025-04-03');
  assert.equal(parseDate(32964), '1990-04-01');                   // serial in a General-format cell
  assert.equal(parseDate('45750'), '2025-04-03');                 // serial exported as text
  assert.equal(parseDate(new Date(Date.UTC(1990, 3, 3))), '1990-04-03');
  assert.equal(parseDate(''), null);
  assert.throws(() => parseDate('31/02/1990'), /Ngày không tồn tại/);
  assert.throws(() => parseDate('03/04/90'), /dd\/mm\/yyyy/);    // 2-digit year: 1990 or 2090? ask
  assert.throws(() => parseDate(1990), /dd\/mm\/yyyy/);          // a bare year is not a date
  assert.throws(() => parseDate(new CellError('Ô bị lỗi #N/A')), /#N\/A/);
});

test('text: NFC, spaces, our own formula escape removed', () => {
  assert.equal(text('Nguyễn  Văn A '), 'Nguyễn Văn A');
  assert.equal(text("'+84912345678"), '+84912345678');
  assert.equal(text("'Lan"), "'Lan");
});

test('delimiter from the header line: vi-VN ";" with decimal commas, title rows, quoted commas', () => {
  assert.equal(detectDelimiter('Họ tên;SĐT;Điểm\nLan;0912345678;1,5\n'), ';');
  assert.equal(detectDelimiter('DANH SÁCH, THÁNG 10\nHọ tên;SĐT;Ngày sinh\n'), ';');
  assert.equal(detectDelimiter('Họ tên,SĐT\n"Lê, Thị C",0912000111\n'), ',');
  assert.equal(detectDelimiter('Họ tên\tSĐT\n'), '\t');
  assert.equal(detectDelimiter('SĐT;Họ tên;Ghi chú\n0912345678;Trần Văn Minh;12 Lê Lợi, Q1, P. Bến Nghé, điểm 1,5\n'), ';');
});

test('CSV injection: OWASP examples and every formula starter', () => {
  assert.equal(csvField('=1+2";=1+2'), '"\'=1+2"";=1+2"');
  assert.equal(csvField('=1+2\'" ;,=1+2'), '"\'=1+2\'"" ;,=1+2"');
  for (const s of ['=HYPERLINK("http://x")', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx', '\nx', '＝1+2']) {
    assert.ok(csvField(s).startsWith(`"'`), JSON.stringify(s));
  }
  assert.equal(csvField('Nguyễn Văn A'), '"Nguyễn Văn A"');
});
