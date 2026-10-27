// apps/api/src/ai/attachments.ts — an uploaded photo or PDF as a content block
import type Anthropic from '@anthropic-ai/sdk';

// Below the API limits (image 10 MB base64 and 8000×8000 px, request 32 MB); base64 adds a third
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// The type comes from the bytes: the file name and the browser's Content-Type are whatever the client sent
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');
const KINDS = [
  { type: 'image/jpeg', is: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', is: (b: Buffer) => ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n' },
  { type: 'image/gif', is: (b: Buffer) => ['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6)) },
  { type: 'image/webp', is: (b: Buffer) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { type: 'application/pdf', is: (b: Buffer) => ascii(b, 0, 5) === '%PDF-' },
] as const;

export class UnsupportedFileError extends Error {}

export function attachmentBlock(bytes: Buffer): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UnsupportedFileError('File lớn hơn 5 MB');
  const kind = KINDS.find((k) => k.is(bytes));
  if (!kind) throw new UnsupportedFileError('Chỉ nhận ảnh JPEG, PNG, GIF, WebP hoặc file PDF');
  const data = bytes.toString('base64');
  return kind.type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: kind.type, data } }
    : { type: 'image', source: { type: 'base64', media_type: kind.type, data } };
}
