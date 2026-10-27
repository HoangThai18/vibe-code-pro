// src/auth/id-token.ts — Sign in with Apple / Google from a native app: verify the ID token on the server
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from '../shared/errors';

export type Provider = 'apple' | 'google';
export interface ProviderConfig { issuer: string | string[]; jwksUrl: URL; audience: string[] }

// audience: your client ids. Apple: the app's bundle id (and the Services ID for web). Google: the web client id
// the app passes to the SDK as serverClientId (Android) or the iOS client id.
export const providerConfig = (apple: string[], google: string[]): Record<Provider, ProviderConfig> => ({
  apple: { issuer: 'https://appleid.apple.com', jwksUrl: new URL('https://appleid.apple.com/auth/keys'), audience: apple },
  google: {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUrl: new URL('https://www.googleapis.com/oauth2/v3/certs'),
    audience: google,
  },
});

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();   // caches keys; refetches on an unknown kid

export interface VerifiedIdentity { provider: Provider; subject: string; email: string | null; emailVerified: boolean }

// The app makes a random nonce per sign-in, gives the provider SDK its SHA-256 (hex) and sends us the raw value:
// a stolen ID token is useless without the raw nonce
export async function verifyIdToken(provider: Provider, idToken: string, rawNonce: string, cfg: ProviderConfig): Promise<VerifiedIdentity> {
  let keys = keySets.get(cfg.jwksUrl.href);
  if (!keys) keySets.set(cfg.jwksUrl.href, (keys = createRemoteJWKSet(cfg.jwksUrl)));
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: cfg.issuer, audience: cfg.audience, algorithms: ['RS256'], maxTokenAge: '10m',
    });
    if (payload.nonce !== createHash('sha256').update(rawNonce).digest('hex')) throw new Error('nonce mismatch');
    if (!payload.sub) throw new Error('no sub');
    return {
      provider,
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',   // Apple may send "true"
    };
  } catch {
    throw new HttpError(401, 'id_token_invalid', 'Đăng nhập không thành công, vui lòng thử lại.');
  }
}
