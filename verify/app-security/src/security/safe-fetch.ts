// apps/api/src/security/safe-fetch.ts
// Fetch user-supplied URLs (link previews, URL imports, customer webhooks) without reaching the internal network
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

export class BlockedUrlError extends Error {}

// Public addresses only: blocks loopback, private networks, link-local (169.254.169.254 is cloud metadata), CGNAT, internal IPv6,
// and IPv4 written as IPv6 (::ffff:127.0.0.1)
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

// Check every address DNS returns, and connect using exactly the checked result: a domain cannot return a public IP at check time
// and an internal IP at connect time (DNS rebinding)
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
  ports?: string[];                               // '' is the http/https default port
  isAllowedAddress?: (ip: string) => boolean;     // override only in tests
}

export async function safeFetchText(input: string, opts: SafeFetchOptions = {}) {
  const { maxBytes = 1_000_000, timeoutMs = 5_000, maxRedirects = 3, ports = ['', '80', '443'], isAllowedAddress = isPublicAddress } = opts;
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(isAllowedAddress) } });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let url = new URL(input);   // URL normalizes: http://2130706433/ and http://0x7f.1/ become http://127.0.0.1/
    for (let redirects = 0; ; redirects++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Chỉ cho phép http và https');
      if (url.username || url.password) throw new BlockedUrlError('Không cho phép URL có tên đăng nhập');
      if (!ports.includes(url.port)) throw new BlockedUrlError(`Không cho phép cổng ${url.port}`);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      // A literal IP in the URL skips DNS lookup, so it must be checked here
      if (net.isIP(host) && !isAllowedAddress(host)) throw new BlockedUrlError(`Không cho phép tải từ ${host}`);

      const res = await fetch(url, { dispatcher, signal, redirect: 'manual' }).catch((err: unknown) => {
        // fetch wraps connection errors in TypeError('fetch failed'); rethrow our block error if it was the cause
        throw err instanceof TypeError && err.cause instanceof BlockedUrlError ? err.cause : err;
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (redirects >= maxRedirects) throw new BlockedUrlError('Quá nhiều lần chuyển hướng');
        url = new URL(location, url);   // the new URL goes through every check again
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
