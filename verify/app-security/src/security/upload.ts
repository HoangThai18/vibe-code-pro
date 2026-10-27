// apps/api/src/security/upload.ts
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export class UploadRejectedError extends Error {}

// Allowlist, not denylist. No SVG or HTML: browsers can run scripts inside them
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export async function checkUpload(data: Uint8Array, maxBytes = 5 * 1024 * 1024) {
  if (data.byteLength === 0 || data.byteLength > maxBytes) throw new UploadRejectedError('Kích thước file không hợp lệ');
  // Read the content's magic bytes; never trust the file extension or the browser-sent Content-Type
  const type = await fileTypeFromBuffer(data);
  const ext = type ? ALLOWED.get(type.mime) : undefined;
  if (!type || !ext) throw new UploadRejectedError('Định dạng file không được phép');
  return { mime: type.mime, ext };
}

// Images: re-encode to strip metadata (EXIF can hold the GPS location where the photo was taken) and to block "bomb" images that decompress to a huge size
export async function normalizeImage(data: Uint8Array): Promise<Buffer> {
  return sharp(data, { limitInputPixels: 40_000_000 })
    .rotate()                                                  // rotate per EXIF before EXIF is dropped
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();                                               // sharp does not copy metadata to the new file by default
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The one place that builds object storage keys: tenants/{tenantId}/{folder}/{uuid}.{ext}, e.g. folder 'customers/<id>'.
// Server-generated; the original filename is stored only in the DB, for display
export function storageKey(tenantId: string, folder: string, ext: string): string {
  if (!UUID.test(tenantId) || !/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(folder)) throw new Error('storageKey: bad tenant id or folder');
  return `tenants/${tenantId}/${folder}/${randomUUID()}.${ext}`;
}
