// test/upload.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { checkUpload, normalizeImage, storageKey, UploadRejectedError } from '../src/security/upload';

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#e88' } }).png().toBuffer();

test('nhận ảnh thật theo nội dung, không theo tên file', async () => {
  assert.deepEqual(await checkUpload(await png()), { mime: 'image/png', ext: 'png' });
  const jpg = await sharp(await png()).jpeg().toBuffer();
  assert.deepEqual(await checkUpload(jpg), { mime: 'image/jpeg', ext: 'jpg' });
});

test('từ chối HTML, SVG, file rỗng, file quá lớn', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');   // dù tên là anh.png
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  for (const data of [html, svg, Buffer.alloc(0)]) await assert.rejects(checkUpload(data), UploadRejectedError);
  await assert.rejects(checkUpload(await png(), 10), UploadRejectedError);
});

test('mã hoá lại ảnh: bỏ EXIF, giới hạn kích thước', async () => {
  const withExif = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#88e' } })
    .jpeg().withExif({ IFD0: { Copyright: 'Chụp tại nhà khách hàng' } }).toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif);
  const out = await normalizeImage(withExif);
  const meta = await sharp(out).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 2000);
});

test('tên lưu trữ do server sinh, theo tenant', () => {
  assert.match(storageKey('spa-a', 'png'), /^spa-a\/[0-9a-f-]{36}\.png$/);
});
