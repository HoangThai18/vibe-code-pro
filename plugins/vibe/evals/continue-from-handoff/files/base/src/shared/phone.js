// '+84 912 345 678', '84912345678', '0912.345.678' → '0912345678'; null if it is not a Vietnamese mobile number.
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);
  return /^0[35789]\d{8}$/.test(digits) ? digits : null;
}
