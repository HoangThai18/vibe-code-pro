// apps/api/src/ai/redact.ts
// Send the model only the data it needs: summarizing notes needs no phone numbers or emails
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// Mobile (0 + 9 digits) and landline (0 + 10 digits: 028 3823 4567), as 0..., 84..., +84..., 0084..., (+84) ...,
// with spaces, dots, dashes or brackets. Not after a digit, dot or comma: 1.500.000.000đ stays
const VN_PHONE = /(?<![\d+.,])\(?(?:\+84|0084|84|0)\)?(?:[\s.()-]{0,2}\d){9,10}(?!\d)/g;

export function redactContacts(text: string): string {
  return text.replace(EMAIL, '[email]').replace(VN_PHONE, '[số điện thoại]');
}
