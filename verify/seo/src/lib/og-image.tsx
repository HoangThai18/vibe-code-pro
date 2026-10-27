// src/lib/og-image.tsx — 1200x630 share image
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };
// Has Vietnamese glyphs; read from the repo once per process, no network
const font = readFile(join(process.cwd(), 'assets/Inter-Bold.otf'));

export async function ogImage(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: 80, background: '#fff7f0', color: '#3b2416', fontFamily: 'Inter' }}>
        <div style={{ fontSize: 72 }}>{title}</div>
        <div style={{ fontSize: 40, marginTop: 24 }}>{subtitle}</div>
      </div>
    ),
    { ...ogSize, fonts: [{ name: 'Inter', data: await font, weight: 700, style: 'normal' }] },
  );
}
