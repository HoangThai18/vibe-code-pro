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
