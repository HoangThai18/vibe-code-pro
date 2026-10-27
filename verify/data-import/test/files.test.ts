// test/files.test.ts — real .xlsx built with exceljs, real CSV bytes
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'csv-parse/sync';
import { ImportFileError } from '../src/imports/cells';
import { readCsv, readXlsx } from '../src/imports/read-file';
import { detectFormat } from '../src/imports/upload';
import { parseRows } from '../src/imports/rows';
import { csv, xlsx } from './helpers';

const fromCsv = (data: Uint8Array) => parseRows(readCsv(data));
const fromXlsx = async (data: Uint8Array) => {
  assert.equal(await detectFormat(data), 'xlsx');
  return parseRows(readXlsx(data));
};
const errorsOf = (r: Awaited<ReturnType<typeof parseRows>>) =>
  r.rows.flatMap((row) => (row.errors ?? []).map((e) => `${row.rowNumber} ${e.column}: ${e.message}`));

test('xlsx: title rows, merged cells, blank rows, number phones, dates, formulas, rich text', async () => {
  const data = await xlsx((ws) => {
    ws.getCell('A1').value = 'DANH SÁCH KHÁCH HÀNG';
    ws.mergeCells('A1:D1');
    ws.getCell('A2').value = 'Xuất ngày 01/10/2026';
    ws.addRow([]);
    ws.getRow(4).values = ['Họ và tên', 'SĐT', 'Ngày sinh', 'E-mail'];
    ws.getRow(5).values = ['Nguyễn Thị Lan', 912345678, new Date(Date.UTC(1990, 3, 3)), 'lan@example.com'];
    ws.getRow(7).values = [{ richText: [{ text: 'Trần ' }, { text: 'Văn Minh', font: { bold: true } }] }, '+84 98 765 4321', '03/04/1985', null];
    ws.getRow(8).values = [{ formula: 'PROPER("hoa")', result: 'Hoa' }, '0912.000.111', 32964, ''];
    ws.getRow(9).values = ['Lê C', '12345', '31/02/1990', 'x@'];
    ws.getRow(10).values = [{ formula: 'A5', result: undefined }, 912345678, null, null];
  });
  const r = await fromXlsx(data);
  assert.deepEqual(r.columns.map((c) => `${c.letter}=${c.field}`), ['A=fullName', 'B=phone', 'C=birthday', 'D=email']);
  assert.deepEqual(r.rows.filter((x) => x.data).map((x) => [x.rowNumber, x.data]), [
    [5, { fullName: 'Nguyễn Thị Lan', phone: '0912345678', birthday: '1990-04-03', email: 'lan@example.com' }],
    [7, { fullName: 'Trần Văn Minh', phone: '0987654321', birthday: '1985-04-03', email: null }],
    [8, { fullName: 'Hoa', phone: '0912000111', birthday: '1990-04-01', email: null }],
  ]);
  assert.deepEqual(errorsOf(r), [
    '9 SĐT (B): SĐT không hợp lệ (ví dụ 0912345678)',
    '9 Ngày sinh (C): Ngày không tồn tại (ví dụ 31/02)',
    '9 E-mail (D): Email không hợp lệ',
    '10 Họ và tên (A): Ô công thức chưa có kết quả: mở file bằng Excel, lưu lại rồi tải lên',
  ]);
});

test('xlsx: merged cells repeat the top-left value in every cell; duplicate phone in the file', async () => {
  const data = await xlsx((ws) => {
    ws.addRow(['Họ tên', 'SĐT']);
    ws.addRow(['Phạm Thu', '0912345678']);
    ws.addRow(['Phạm Thu', '0912345678']);
    ws.mergeCells('A2:A3');
  });
  const r = await fromXlsx(data);
  assert.deepEqual(errorsOf(r), ['3 SĐT (B): SĐT trùng với dòng 2']);
});

test('csv: BOM stripped (Excel "CSV UTF-8"), multi-line cell keeps Excel row numbers, blank lines kept', async () => {
  const r = await fromCsv(csv(['Họ tên|Số điện thoại|Ngày sinh', '"Lê\nThị C"|912345678|03/04/1990', '', 'Bad|1|']));
  assert.equal(r.columns[0]?.header, 'Họ tên');                    // not '\uFEFFHọ tên'
  assert.equal(r.rows[0]?.data?.phone, '0912345678');
  assert.deepEqual(errorsOf(r), ['4 Số điện thoại (B): SĐT không hợp lệ (ví dụ 0912345678)']);
  // Without the decoder: Buffer.toString keeps the BOM and the first header no longer matches
  assert.equal(Buffer.from(csv(['Họ tên'])).toString('utf8').charCodeAt(0), 0xfeff);
});

test('csv: ";" from vi-VN Excel, commas inside unquoted fields', async () => {
  const r = await fromCsv(csv(['SĐT|Họ tên|Ghi chú', '0912345678|Trần Văn Minh|12 Lê Lợi, Q1, điểm 1,5'], { delimiter: ';', bom: false }));
  assert.deepEqual(r.rows[0]?.data, { fullName: 'Trần Văn Minh', phone: '0912345678', birthday: null, email: null });
  // csv-parse's own delimiter_auto (7.0.3) is not usable here: it picks ' ' on ASCII text and throws on Vietnamese
  assert.deepEqual(parse('Ho ten;SDT\nNguyen Van An;0912345678\n', { delimiter_auto: true, relax_column_count: true })[0], ['Ho', 'ten;SDT']);
  assert.throws(() => parse('Họ tên;SĐT\nAn;0912345678\n', { delimiter_auto: true }), TypeError);
});

test('csv: Windows-1258 / legacy bytes are rejected with a re-export instruction, not guessed', async () => {
  // "Nguyễn Văn An" in Windows-1258: ê = 0xEA, combining tilde = 0xDE, ă = 0xE3
  const legacy = new Uint8Array([...new TextEncoder().encode('Ho ten,SDT\r\nNguy'), 0xea, 0xde,
    ...new TextEncoder().encode('n V'), 0xe3, ...new TextEncoder().encode('n An,0912345678\r\n')]);
  assert.equal(await detectFormat(legacy), 'csv');
  await assert.rejects(fromCsv(legacy), (e: Error) => e instanceof ImportFileError && /không phải UTF-8.*CSV UTF-8/.test(e.message));
  await assert.rejects(fromCsv(csv(['Họ tên,SĐT', 'Nguy\uFFFDn,0912345678'])), /ký tự lỗi/);
  const r = await fromCsv(csv(['Họ tên,SĐT', 'Nguy?n V?n An,0912345678']));   // "?" left by an ANSI save
  assert.deepEqual(errorsOf(r), ['2 Họ tên (A): Họ tên có ký tự lỗi (? hoặc �): lưu file dạng CSV UTF-8 rồi tải lại']);
});

test('upload checks: size, .xls / password-protected (CFB), other binaries, header not found, row limit', async () => {
  await assert.rejects(detectFormat(new Uint8Array(0)), /File rỗng/);
  await assert.rejects(detectFormat(new Uint8Array(10 * 1024 * 1024 + 1)), /lớn hơn 10 MB/);
  await assert.rejects(detectFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(600)])), /\.xls/);
  await assert.rejects(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), /Chỉ nhận/);
  await assert.rejects(fromCsv(csv(['Tên sản phẩm,Giá', 'Dầu gội,100000'])), /Không thấy dòng tiêu đề/);
  const many = csv(['Họ tên,SĐT', ...Array.from({ length: 11 }, (_, i) => `K${i},09123456${String(i).padStart(2, '0')}`)]);
  await assert.rejects(parseRows(readCsv(many), 10), /hơn 10 dòng/);
});
