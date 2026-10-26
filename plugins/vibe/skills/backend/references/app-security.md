# Bảo mật ứng dụng: các lỗ hay gặp ngoài đăng nhập và phân quyền

Đăng nhập, phiên, phân quyền, webhook ở `auth.md`; cô lập tenant ở `multi-tenant.md`. File này là các lỗ còn lại hay gặp khi làm tính năng. Code đã chạy với Node 22, TypeScript strict, PostgreSQL 16 (12 test pass; bỏ từng lớp chặn trong `safe-fetch.ts` thì có test fail); hai workflow đã qua actionlint; gitleaks đã thử bắt key giả trong repo mẫu.

## Mục lục
1. Năm câu hỏi trước khi làm một tính năng
2. Upload file
3. Server tải URL do người dùng đưa (SSRF)
4. Giới hạn số lần gọi (rate limit)
5. Header bảo mật
6. Secret và dependency trong CI
7. Lỗi và log

## 1. Năm câu hỏi trước khi làm một tính năng

Trả lời ngắn trong task card (skill `tasks`), mục "Bảo mật". Mất vài phút, tránh được phần lớn lỗ ở các mục dưới:

1. Tính năng đọc hoặc ghi **dữ liệu gì**, của ai? Có dữ liệu cá nhân, dữ liệu nhạy cảm không (`privacy.md`)?
2. **Ai** được làm, kiểm ở đâu (tenant, vai trò, chủ sở hữu bản ghi)?
3. **Đầu vào** đến từ đâu: form, file upload, URL, webhook, dữ liệu từ hệ thống khác? Cái nào do người ngoài kiểm soát?
4. Server có **gọi ra ngoài** không (URL do người dùng nhập, API bên thứ ba, gửi email/SMS)?
5. Nếu bị **lạm dụng** (gọi 10.000 lần, nhập dữ liệu độc hại, người trong tenant cố xem tenant khác) thì thiệt hại là gì, và cái gì chặn?

## 2. Upload file

```ts
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
```

Test (đã chạy): PNG và JPEG thật được nhận; nội dung HTML đặt tên `.png`, SVG có `onload`, file rỗng, file quá lớn bị từ chối; ảnh có EXIF sau khi mã hoá lại không còn EXIF.

Khi lưu và trả file:

- Lưu ở object storage, bucket **riêng tư**; trả cho người dùng bằng URL ký có hạn ngắn (vài phút) sau khi kiểm quyền (skill `backend`, `data-layer.md` phần lưu file).
- Không phục vụ file người dùng tải lên từ cùng domain với app. Bắt buộc phải cùng domain thì gửi kèm `Content-Type` đúng, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` cho file không phải ảnh.
- Tên file gốc chỉ để hiển thị, không bao giờ dùng làm đường dẫn lưu.
- Giới hạn kích thước ở cả proxy (vd nginx `client_max_body_size`) lẫn app; giới hạn số file mỗi người dùng mỗi ngày.
- File từ người ngoài (khách gửi qua form công khai) có thể quét virus bằng job nền trước khi cho nhân viên mở.

## 3. Server tải URL do người dùng đưa (SSRF)

Xem trước link, nhập dữ liệu từ URL, gửi webhook tới URL của khách: server gửi request tới địa chỉ do người khác chọn. Không chặn thì người đó đọc được dịch vụ nội bộ, trang quản trị chỉ mở trong mạng riêng, hoặc metadata của máy chủ cloud (`169.254.169.254`, chứa cả credential tạm của máy).

```bash
npm install undici ipaddr.js
```

```ts
// apps/api/src/security/safe-fetch.ts
// Server tải URL do người dùng đưa (xem trước link, nhập dữ liệu từ URL, webhook của khách) mà không chạm được mạng nội bộ
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

export class BlockedUrlError extends Error {}

// Chỉ địa chỉ công khai: chặn loopback, mạng riêng, link-local (169.254.169.254 là metadata của cloud), CGNAT, IPv6 nội bộ,
// và IPv4 viết dạng IPv6 (::ffff:127.0.0.1)
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

// Kiểm mọi địa chỉ DNS trả về, và kết nối bằng chính kết quả đã kiểm: tên miền không thể trả IP công khai lúc kiểm
// rồi IP nội bộ lúc kết nối (DNS rebinding)
function guardedLookup(isAllowed: (ip: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      if (addresses.length === 0 || addresses.some((a) => !isAllowed(a.address))) {
        return callback(new BlockedUrlError(`Không cho phép tải từ ${hostname}`), '', 0);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  ports?: string[];                               // '' là cổng mặc định của http/https
  isAllowedAddress?: (ip: string) => boolean;     // chỉ đổi trong test
}

export async function safeFetchText(input: string, opts: SafeFetchOptions = {}) {
  const { maxBytes = 1_000_000, timeoutMs = 5_000, maxRedirects = 3, ports = ['', '80', '443'], isAllowedAddress = isPublicAddress } = opts;
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(isAllowedAddress) } });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let url = new URL(input);   // URL tự chuẩn hoá: http://2130706433/ và http://0x7f.1/ thành http://127.0.0.1/
    for (let redirects = 0; ; redirects++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Chỉ cho phép http và https');
      if (url.username || url.password) throw new BlockedUrlError('Không cho phép URL có tên đăng nhập');
      if (!ports.includes(url.port)) throw new BlockedUrlError(`Không cho phép cổng ${url.port}`);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      // IP viết thẳng trong URL không đi qua DNS lookup nên phải kiểm ở đây
      if (net.isIP(host) && !isAllowedAddress(host)) throw new BlockedUrlError(`Không cho phép tải từ ${host}`);

      const res = await fetch(url, { dispatcher, signal, redirect: 'manual' }).catch((err: unknown) => {
        // fetch bọc lỗi kết nối trong TypeError('fetch failed'); trả lại lỗi chặn của mình nếu đó là nguyên nhân
        throw err instanceof TypeError && err.cause instanceof BlockedUrlError ? err.cause : err;
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (redirects >= maxRedirects) throw new BlockedUrlError('Quá nhiều lần chuyển hướng');
        url = new URL(location, url);   // URL mới đi lại toàn bộ các bước kiểm
        continue;
      }
      return { url: url.href, status: res.status, contentType: res.headers.get('content-type') ?? '', body: await readLimited(res.body, maxBytes) };
    }
  } finally {
    await dispatcher.close();
  }
}

async function readLimited(body: AsyncIterable<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new BlockedUrlError(`Nội dung lớn hơn ${maxBytes} byte`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
```

Test (đã chạy):

```ts
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
```

- Chặn theo địa chỉ IP sau khi phân giải, không theo tên miền: danh sách cấm tên miền luôn có cách vòng qua (IP viết dạng thập phân, tên miền trỏ về 127.0.0.1, chuyển hướng).
- Chạy việc tải URL trong job nền nếu có thể (skill `backend`, `jobs.md`), để request của người dùng không chờ server lạ.
- Webhook gửi đi: kiểm URL lúc khách lưu cấu hình **và** lúc gửi (DNS có thể đổi), ký nội dung gửi đi để bên nhận kiểm (`auth.md`).

## 4. Giới hạn số lần gọi (rate limit)

Áp cho: đăng nhập, quên mật khẩu, gửi OTP (theo IP **và** theo tài khoản), endpoint công khai, tính năng tốn tiền (AI, SMS), xuất dữ liệu.

```sql
-- UNLOGGED: nhanh hơn, mất dữ liệu khi Postgres sập (chấp nhận được với bộ đếm); job dọn dòng cũ mỗi giờ
CREATE UNLOGGED TABLE rate_limits (
  key          text        NOT NULL,   -- vd 'login:ip:1.2.3.4', 'ai:user:<uuid>'
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  PRIMARY KEY (key, window_start)
);
-- Dọn: DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
```

```ts
// apps/api/src/security/rate-limit.ts
import type { Pool, PoolClient } from 'pg';

// Cửa sổ cố định, đếm trong Postgres: đúng cả khi chạy nhiều instance app, không cần thêm Redis
export async function hitRateLimit(db: Pool | PoolClient, key: string, limit: number, windowSeconds: number) {
  const { rows } = await db.query<{ count: number; retry_after: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count, ceil(extract(epoch FROM window_start + make_interval(secs => $2) - now()))::int AS retry_after`,
    [key, windowSeconds],
  );
  const row = rows[0]!;
  return { allowed: row.count <= limit, retryAfterSeconds: Math.max(1, row.retry_after) };
}
```

Test (đã chạy): 50 request song song vào cùng khoá với giới hạn 10 thì đúng 10 request được qua.

- Vượt giới hạn: trả `429` kèm header `Retry-After: <retryAfterSeconds>` và mã lỗi riêng, vd `rate_limited` (bảng mã lỗi ở `api-conventions.md`).
- Khoá theo IP lấy IP thật của client: sau proxy/load balancer thì cấu hình app tin đúng số proxy phía trước, không tin `X-Forwarded-For` do client tự gửi.
- Lượng request rất lớn thì đặt thêm giới hạn ở tầng proxy/CDN; bảng này dành cho giới hạn theo nghiệp vụ.

## 5. Header bảo mật

| Header | Giá trị gợi ý | Chặn gì |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Trình duyệt luôn dùng HTTPS |
| `Content-Security-Policy` | Bắt đầu từ `default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, thêm nguồn cần thiết | Script lạ chạy trong trang (XSS), trang bị nhúng vào iframe |
| `X-Content-Type-Options` | `nosniff` | Trình duyệt đoán kiểu file và chạy nhầm |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Lộ đường dẫn có id, token ra trang khác |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` (bật cái cần) | Trang dùng thiết bị không cần thiết |

Đặt ở proxy hoặc middleware chung (vd `helmet` cho Express/Fastify). Thử CSP ở chế độ `Content-Security-Policy-Report-Only` trước rồi mới bật chặn. Cookie phiên: `HttpOnly; Secure; SameSite=Lax` (`auth.md`).

## 6. Secret và dependency trong CI

```yaml
# .github/workflows/security.yml — chạy ở mọi PR và mỗi tuần
name: Security
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "0 1 * * 1"   # 08:00 thứ Hai giờ Việt Nam: lỗ hổng mới công bố trong tuần
permissions:
  contents: read
jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0               # quét cả lịch sử: secret đã xoá khỏi code vẫn nằm trong git
      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"
      - name: Cài gitleaks
        run: go install github.com/zricethezav/gitleaks/v8@v8.30.1
      - name: Quét secret (fail nếu tìm thấy)
        run: '"$(go env GOPATH)/bin/gitleaks" git . --no-banner --redact'
  dependencies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Lỗ hổng mức high trở lên trong dependency chạy ở production
        run: npm audit --omit=dev --audit-level=high
```

- gitleaks quét **cả lịch sử git**: đã thử, xoá file chứa key rồi commit thì lần quét sau vẫn báo. Lộ secret thì **thu hồi và tạo key mới ngay**; xoá khỏi code không đủ, vì key vẫn nằm trong lịch sử và trong các bản clone.
- Thêm gitleaks vào pre-commit trên máy dev để chặn trước khi commit.
- `npm audit` báo lỗ hổng của gói đã biết; cập nhật dependency định kỳ bằng Dependabot hoặc Renovate (skill `ship`, `maintenance.md`). Dự án Python dùng `pip-audit`, Go dùng `govulncheck`.
- Bật secret scanning và Dependabot alerts của GitHub (miễn phí cho repo công khai).

## 7. Lỗi và log

- Không trả stack trace, câu SQL, đường dẫn file trong response lỗi; trả mã lỗi và `requestId` để tra log (`api-conventions.md`).
- Không ghi vào log: mật khẩu, token, khoá API, nội dung cookie, số thẻ, và dữ liệu cá nhân không cần cho việc điều tra (`privacy.md`). Lọc ở logger (danh sách trường bị che), không trông vào từng chỗ gọi log.
- Ghi log cho sự kiện bảo mật: đăng nhập thất bại liên tiếp, đổi quyền, xuất dữ liệu, truy cập dữ liệu nhạy cảm; giữ đủ lâu để điều tra sự cố (skill `fix`).
