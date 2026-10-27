// test/safe-fetch.test.ts
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { BlockedUrlError, isPublicAddress, safeFetchText } from '../src/security/safe-fetch';

test('chỉ địa chỉ công khai là được phép', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('chặn URL trỏ vào máy chủ, mạng nội bộ, metadata cloud, giao thức lạ, trước khi kết nối', async () => {
  for (const url of [
    'http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.1/',
    'file:///etc/passwd', 'ftp://example.com/', 'http://user:pass@example.com/', 'http://example.com:8080/',
  ]) {
    await assert.rejects(safeFetchText(url), BlockedUrlError, url);
  }
});

// Server thử nằm ở 127.0.0.1, nên test cho riêng địa chỉ và cổng của nó; mọi thứ khác vẫn bị chặn như thật
let server: Server;
let port = '';
const local = () => ({ isAllowedAddress: (ip: string) => ip === '127.0.0.1', ports: [port] });

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') return void res.end('<title>Spa Hoa Sen</title>');
    if (req.url === '/to-metadata') return void res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    if (req.url === '/to-ipv6-loopback') return void res.writeHead(302, { location: `http://[::1]:${port}/ok` }).end();
    if (req.url === '/big') return void res.end('x'.repeat(2_000_000));
    if (req.url === '/slow') return void setTimeout(() => res.end('muộn'), 3_000);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = String((server.address() as AddressInfo).port);
});
after(() => server.close());

test('tải được trang hợp lệ', async () => {
  const res = await safeFetchText(`http://127.0.0.1:${port}/ok`, local());
  assert.equal(res.status, 200);
  assert.match(res.body, /Spa Hoa Sen/);
});

test('chuyển hướng sang địa chỉ nội bộ cũng bị chặn', async () => {
  await assert.rejects(safeFetchText(`http://127.0.0.1:${port}/to-metadata`, local()), BlockedUrlError);
  await assert.rejects(safeFetchText(`http://127.0.0.1:${port}/to-ipv6-loopback`, local()), BlockedUrlError);
});

test('tên miền phân giải ra địa chỉ nội bộ thì bị chặn ở bước kết nối', async () => {
  // Không phải IP viết thẳng: chặn nhờ kiểm kết quả DNS (localhost → 127.0.0.1), với chính sách mặc định
  await assert.rejects(safeFetchText(`http://localhost:${port}/ok`, { ports: [port] }), BlockedUrlError);
});

test('giới hạn kích thước và thời gian', async () => {
  await assert.rejects(safeFetchText(`http://127.0.0.1:${port}/big`, local()), BlockedUrlError);
  await assert.rejects(safeFetchText(`http://127.0.0.1:${port}/slow`, { ...local(), timeoutMs: 500 }), { name: 'TimeoutError' });
});
