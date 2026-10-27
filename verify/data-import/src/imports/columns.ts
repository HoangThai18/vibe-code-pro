// apps/api/src/imports/columns.ts
import { text, type CellValue } from './cells';

export const FIELDS = ['fullName', 'phone', 'birthday', 'email'] as const;
export type Field = (typeof FIELDS)[number];
export interface Column { index: number; letter: string; header: string; field: Field }

// Compared after folding: no diacritics, lower case, punctuation as spaces ('Số ĐT' -> 'so dt')
const ALIASES: Record<Field, string[]> = {
  fullName: ['ho ten', 'ho va ten', 'ten khach hang', 'ten khach', 'khach hang', 'ten', 'full name', 'name'],
  phone: ['so dien thoai', 'sdt', 'so dt', 'dien thoai', 'dt', 'di dong', 'phone', 'mobile'],
  birthday: ['ngay sinh', 'sinh nhat', 'birthday', 'date of birth', 'dob'],
  email: ['email', 'e mail', 'thu dien tu'],
};
const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const FIELD_BY_ALIAS = new Map(FIELDS.flatMap((f) => ALIASES[f].map((alias) => [alias, f] as const)));
const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

// The header is the first row with both a name and a phone column; title rows above it are skipped
export function findHeader(cells: CellValue[]): Column[] | null {
  const columns: Column[] = [];
  cells.forEach((cell, index) => {
    const field = FIELD_BY_ALIAS.get(fold(text(cell)));
    if (field && !columns.some((c) => c.field === field)) columns.push({ index, letter: letter(index), header: text(cell), field });
  });
  return columns.some((c) => c.field === 'fullName') && columns.some((c) => c.field === 'phone') ? columns : null;
}

// Where ',' is the decimal separator (vi-VN: 1,5) files often use ';', and addresses hold commas, so counting
// characters guesses wrong. The delimiter is the one that turns one of the first 20 lines into our header.
export function detectDelimiter(content: string): string {
  for (const line of content.split(/\r?\n/, 20)) {
    for (const d of [',', ';', '\t']) if (findHeader(line.split(d))) return d;
  }
  return ',';                                            // no header at all: parseRows reports it
}
