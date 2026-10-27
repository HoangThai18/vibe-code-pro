// src/i18n/text.ts — Vietnamese text helpers
// All free-text input: NFC (NFD looks identical but compares unequal), trimmed, single spaces
export const cleanText = (s: string): string => s.normalize('NFC').trim().replace(/\s+/gu, ' ');

// Anh, Ánh, Ăn, Âu, Bình, Dương, Đặng; plain sort() is UTF-16 order (Á, Đ after Z)
export const compareVi = new Intl.Collator('vi').compare;

// For SMS without diacritics. NFD + strip marks leaves đ/Đ (separate letters), so map them explicitly.
export const removeDiacritics = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
