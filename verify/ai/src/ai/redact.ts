// apps/api/src/ai/redact.ts
// Chỉ gửi cho model dữ liệu nó cần: tóm tắt ghi chú không cần số điện thoại, email
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const VN_PHONE = /(?<!\d)(?:\+84|0084|0)(?:[\s.-]?\d){9}(?!\d)/g;

export function redactContacts(text: string): string {
  return text.replace(EMAIL, '[email]').replace(VN_PHONE, '[số điện thoại]');
}
