// src/auth/routes.ts — the native-app contract; errors render as { error: { code, message } }
import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyIdToken, type Provider, type ProviderConfig } from './id-token';
import { loginWithIdToken, loginWithPassword } from './login';
import { issueTokens, refreshTokens, revokeFamily, type Platform, type TokenConfig } from './tokens';

const LoginBody = z.union([
  z.object({ email: z.email(), password: z.string().min(1).max(1024) }),
  z.object({ provider: z.enum(['apple', 'google']), idToken: z.string().min(1), nonce: z.string().min(16) }),
]);
const RefreshBody = z.object({ refreshToken: z.string().min(1).max(200) });
const PLATFORMS: readonly string[] = ['ios', 'android', 'macos', 'windows', 'linux'];
const platformOf = (req: Request) => {
  const p = req.header('x-app-platform');
  return p && PLATFORMS.includes(p) ? (p as Platform) : null;
};

export function authRoutes(pool: Pool, tokens: TokenConfig, providers: Record<Provider, ProviderConfig>): Router {
  const r = Router();
  // Rate-limit login per IP and per account first (app-security.md section 4)
  r.post('/v1/auth/login', async (req, res) => {
    const body = LoginBody.parse(req.body);
    const userId = 'email' in body
      ? await loginWithPassword(pool, body.email, body.password)
      : await loginWithIdToken(pool, await verifyIdToken(body.provider, body.idToken, body.nonce, providers[body.provider]));
    res.json({ data: await issueTokens(pool, userId, platformOf(req), tokens) });
  });
  r.post('/v1/auth/refresh', async (req, res) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    res.json({ data: await refreshTokens(pool, refreshToken, tokens) });
  });
  r.post('/v1/auth/logout', async (req, res) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    await revokeFamily(pool, refreshToken);
    res.status(204).end();
  });
  return r;
}
