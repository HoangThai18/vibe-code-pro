import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanText, compareVi, removeDiacritics } from '../src/i18n/text';

const names = ['Đặng', 'Dương', 'Ánh', 'Bình', 'Anh', 'Âu', 'Ăn', 'Zô'];

test('Vietnamese collation vs default sort and root localeCompare', () => {
  assert.deepEqual([...names].sort(compareVi), ['Anh', 'Ánh', 'Ăn', 'Âu', 'Bình', 'Dương', 'Đặng', 'Zô']);
  assert.deepEqual([...names].sort(), ['Anh', 'Bình', 'Dương', 'Zô', 'Ánh', 'Âu', 'Ăn', 'Đặng']);
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b)), ['Ăn', 'Anh', 'Ánh', 'Âu', 'Bình', 'Đặng', 'Dương', 'Zô']);
  assert.deepEqual(['á', 'à', 'a', 'ả', 'ã', 'ạ'].sort(compareVi), ['a', 'à', 'ả', 'ã', 'á', 'ạ']);
});

test('NFD input looks the same but is a different string until normalized', () => {
  const nfd = 'Nguyễn'.normalize('NFD');
  assert.notEqual(nfd, 'Nguyễn');
  assert.equal(nfd.length, 8);
  assert.equal('Nguyễn'.length, 6);
  assert.equal('Nguyễn Văn A'.includes(nfd), false);
  assert.equal(cleanText(`  ${nfd}   Văn  A `), 'Nguyễn Văn A');
});

test('removeDiacritics handles đ/Đ, which NFD + strip marks leaves alone', () => {
  const stripOnly = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
  assert.equal(stripOnly('Đặng'), 'Đang');
  assert.equal(removeDiacritics('Đặng Thị Ánh'), 'Dang Thi Anh');
  assert.equal(removeDiacritics('ăâđêôơư ĂÂĐÊÔƠƯ'), 'aadeoou AADEOOU');
  assert.equal(removeDiacritics('Chào Lan, nhắc lịch hẹn của bạn lúc 15:30'), 'Chao Lan, nhac lich hen cua ban luc 15:30');
  assert.equal(removeDiacritics('Nguyễn'.normalize('NFD')), 'Nguyen');
});

test('upper/lower case is safe for Vietnamese', () => {
  assert.equal('Đặng Thị Ánh'.toUpperCase(), 'ĐẶNG THỊ ÁNH');
  assert.equal('ĐẶNG THỊ ÁNH'.toLowerCase(), 'đặng thị ánh');
});
