import { randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O, U, so codes read aloud or retyped from a phone stay unambiguous
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const checkValue = (body: string) => [...body].reduce((n, ch) => (n * 32 + ALPHABET.indexOf(ch)) % 37, 0);

// 8 random characters + 1 check character, unique per tenant (retry the insert on a unique violation).
// Random, not a sequence: a typo never lands on the next customer's deposit, and codes reveal no volume.
export function newPaymentCode(): string {
  for (;;) {
    const body = Array.from(randomBytes(8), (b) => ALPHABET[b & 31]).join('');
    const check = checkValue(body);
    // Values 32-36 would need Crockford's check symbols *~$=U, which banking apps strip: draw again
    if (check < 32) return body + ALPHABET[check];
  }
}

// Mod 37 is prime: any single wrong character and any two swapped neighbors fail the check
export function isPaymentCode(code: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{9}$/.test(code) && ALPHABET[checkValue(code.slice(0, 8))] === code[8];
}

// The code in a transfer note ("chuyen tien SPAK7M1Q0XA7"), or null. Accepts lower case and O/I/L for 0/1;
// a code that fails the check is a typo: unmatched, a person matches it by hand.
export function findPaymentCode(note: string): string | null {
  const typed = /\bSPA[ -]?([0-9A-Z]{9})\b/i.exec(note)?.[1];
  const code = typed?.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return code && isPaymentCode(code) ? code : null;
}
