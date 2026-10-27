// test/upload.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { checkUpload, normalizeImage, storageKey, UploadRejectedError } from '../src/security/upload';

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#e88' } }).png().toBuffer();

test('accepts real images by content, not by file name', async () => {
  assert.deepEqual(await checkUpload(await png()), { mime: 'image/png', ext: 'png' });
  const jpg = await sharp(await png()).jpeg().toBuffer();
  assert.deepEqual(await checkUpload(jpg), { mime: 'image/jpeg', ext: 'jpg' });
});

test('rejects HTML, SVG, empty and oversized files', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');   // even if named anh.png
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  for (const data of [html, svg, Buffer.alloc(0)]) await assert.rejects(checkUpload(data), UploadRejectedError);
  await assert.rejects(checkUpload(await png(), 10), UploadRejectedError);
});

test('re-encoding drops EXIF and caps the size', async () => {
  const withExif = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#88e' } })
    .jpeg().withExif({ IFD0: { Copyright: 'Chụp tại nhà khách hàng' } }).toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif);
  const out = await normalizeImage(withExif);
  const meta = await sharp(out).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 2000);
});

test('storage keys: server-generated, under tenants/{tenantId}/, no path tricks', () => {
  const tenant = '0b6a7c4e-3f0e-4d43-9a2f-5c1e1f0d9b11';
  const customer = '5f8e2d1c-7a6b-4c3d-9e8f-0a1b2c3d4e5f';
  assert.match(storageKey(tenant, `customers/${customer}`, 'pdf'), new RegExp(`^tenants/${tenant}/customers/${customer}/[0-9a-f-]{36}\\.pdf$`));
  for (const [t, folder] of [['spa-a', 'customers'], [tenant, '../other'], [tenant, 'customers//x'], [tenant, '/abs']]) {
    assert.throws(() => storageKey(t!, folder!, 'png'), /storageKey/);
  }
});
