// Chuẩn hoá số điện thoại Việt Nam về dạng 0xxxxxxxxx; không hợp lệ thì trả null.
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[\s.\-()]/g, '').replace(/^\+?84/, '0');
  return /^0\d{9}$/.test(digits) ? digits : null;
}
