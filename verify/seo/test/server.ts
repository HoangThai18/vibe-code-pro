// test/server.ts — start the built app; the same build runs as production and as staging
import { spawn, type ChildProcess } from 'node:child_process';
import { seoOf } from './html';

export const SITE = process.env.SITE_URL ?? 'https://datlich.example.vn';   // must match the build
const children: ChildProcess[] = [];

export async function start(port: number, appEnv: 'production' | 'staging') {
  const env = { ...process.env, APP_ENV: appEnv, SITE_URL: SITE };
  children.push(spawn('node_modules/.bin/next', ['start', '-p', String(port)], { env, stdio: 'ignore' }));
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`http://localhost:${port}`);
      return `http://localhost:${port}`;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`next start on port ${port} did not start`);
}

export const stopAll = () => children.forEach((c) => c.kill());
export const get = (base: string, path: string) => fetch(base + path, { redirect: 'manual' });
export async function page(base: string, path: string) {
  const res = await get(base, path);
  const html = await res.text();
  return { res, html, seo: seoOf(html) };
}
export const url = (path: string) => new URL(path, SITE).href;          // '/' -> 'https://datlich.example.vn/'
export const norm = (href?: string) => href && new URL(href).href;
