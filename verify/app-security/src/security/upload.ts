// apps/api/src/security/upload.ts
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export class UploadRejectedError extends Error {}

// Danh sách cho phép, không phải danh sách cấm. Không có SVG, HTML: trình duyệt chạy được script trong đó
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export async function checkUpload(data: Uint8Array, maxBytes = 5 * 1024 * 1024) {
  if (data.byteLength === 0 || data.byteLength > maxBytes) throw new UploadRejectedError('Kích thước file không hợp lệ');
  // Đọc magic bytes của nội dung, không tin đuôi file hay Content-Type do trình duyệt gửi
  const type = await fileTypeFromBuffer(data);
  const ext = type ? ALLOWED.get(type.mime) : undefined;
  if (!type || !ext) throw new UploadRejectedError('Định dạng file không được phép');
  return { mime: type.mime, ext };
}

// Ảnh: mã hoá lại để bỏ metadata (EXIF có thể chứa toạ độ GPS nơi chụp) và chặn ảnh "khổng lồ" giải nén ra rất lớn
export async function normalizeImage(data: Uint8Array): Promise<Buffer> {
  return sharp(data, { limitInputPixels: 40_000_000 })
    .rotate()                                                  // xoay theo EXIF trước khi bỏ EXIF
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();                                               // sharp mặc định không chép metadata sang file mới
}

// Tên lưu trữ do server sinh, có tenant ở đầu; tên file gốc chỉ lưu trong DB để hiển thị
export function storageKey(tenantId: string, ext: string): string {
  return `${tenantId}/${randomUUID()}.${ext}`;
}
