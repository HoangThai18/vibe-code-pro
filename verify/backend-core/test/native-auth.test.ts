// auth.md section 9: the native-app contract (login, refresh rotation with reuse detection, logout, ID tokens)
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tokenConfig } from '../src/app';
import type { ProviderConfig } from '../src/auth/id-token';
import { buildApp } from '../src/http/build-app';
import { createTenant } from '../src/db/tenant';
import { createUser, PASSWORD } from './helpers/factories';
import { newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const pool = newAppPool();

// A local stand-in for https://appleid.apple.com/auth/keys: our own RSA key, served as a JWKS
let server: Server;
let signingKey: CryptoKey;
let strangerKey: CryptoKey;
let apple: ProviderConfig;
let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  strangerKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  server = createServer((_req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  apple = { issuer: 'https://appleid.apple.com', jwksUrl: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/keys`), audience: ['vn.example.spa'] };
  app = buildApp(pool, { tokens: tokenConfig, providers: { apple, google: apple }, minVersions: () => ({ ios: '1.4.0' }) });
});
afterAll(async () => {
  server.close();
  await Promise.all([admin.end(), pool.end()]);
});
beforeEach(() => reset(admin));

const NONCE = 'raw-nonce-0123456789abcdef';
const idToken = (claims: Record<string, unknown> = {}, key: CryptoKey = signingKey, aud = 'vn.example.spa') =>
  new SignJWT({ nonce: createHash('sha256').update(NONCE).digest('hex'), email: 'Lan@Example.com', email_verified: 'true', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://appleid.apple.com').setAudience(aud)
    .setSubject('001234.apple-sub').setIssuedAt().setExpirationTime('5m').sign(key);
const native = (path: string) => request(app).post(path).set('x-app-platform', 'ios').set('x-app-version', '1.4.2');

describe('password login and the token contract', () => {
  it('login → 200 { data: { accessToken, refreshToken, expiresIn } }; the access token opens the API', async () => {
    const { userId, email } = await createUser('lan');
    const tenantId = await createTenant(pool, userId, 'Spa');
    const res = await native('/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken']);
    expect(res.body.data.expiresIn).toBe(900);
    const list = await request(app).get(`/v1/t/${tenantId}/customers`).set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(list.status).toBe(200);
    expect((await request(app).get(`/v1/t/${tenantId}/customers`)).status).toBe(401);
  });

  it('wrong password and unknown email get the same 401', async () => {
    const { email } = await createUser('lan');
    const wrong = await native('/v1/auth/login').send({ email, password: 'sai-mat-khau-roi' });
    const unknown = await native('/v1/auth/login').send({ email: 'khong-co@example.com', password: 'sai-mat-khau-roi' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('invalid_credentials');
  });

  it('an app older than the minimum gets 426 app_update_required', async () => {
    const res = await request(app).post('/v1/auth/login').set('x-app-platform', 'ios').set('x-app-version', '1.3.9').send({});
    expect(res.status).toBe(426);
    expect(res.body.error.code).toBe('app_update_required');
  });
});

describe('refresh rotation', () => {
  const loginTokens = async () => {
    const { email } = await createUser('lan');
    return (await native('/v1/auth/login').send({ email, password: PASSWORD })).body.data as { refreshToken: string };
  };
  const refresh = (refreshToken: string) => native('/v1/auth/refresh').send({ refreshToken });

  it('each refresh returns a new pair; the old refresh token is spent', async () => {
    const first = await loginTokens();
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);
    expect(second.body.data.refreshToken).not.toBe(first.refreshToken);
    expect((await refresh(second.body.data.refreshToken)).status).toBe(200);
  });

  it('reusing a spent token revokes the whole family → 401 refresh_invalid', async () => {
    const first = await loginTokens();
    const second = (await refresh(first.refreshToken)).body.data;
    const reuse = await refresh(first.refreshToken);              // e.g. a stolen copy
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('refresh_invalid');
    expect((await refresh(second.refreshToken)).status).toBe(401);   // the legitimate holder is logged out too
    expect((await admin.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE revoked_at IS NULL')).rows[0].n).toBe(0);
  });

  it('two parallel refreshes with one token: one wins, then the family is revoked', async () => {
    const first = await loginTokens();
    const results = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const winner = results.find((r) => r.status === 200)!.body.data.refreshToken;
    expect((await refresh(winner)).status).toBe(401);   // why the app must refresh once at a time
  });

  it('logout → 204 and the family is gone; unknown and expired tokens → 401', async () => {
    const first = await loginTokens();
    expect((await native('/v1/auth/logout').send({ refreshToken: first.refreshToken })).status).toBe(204);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh('khong-ton-tai')).status).toBe(401);
    const other = await loginTokens();
    await admin.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'");
    expect((await refresh(other.refreshToken)).status).toBe(401);
  });
});

describe('Sign in with Apple / Google: ID token checked against the provider JWKS', () => {
  const social = async (token: string, nonce = NONCE) =>
    native('/v1/auth/login').send({ provider: 'apple', idToken: token, nonce });

  it('a valid token creates the user once and links by sub, not by email', async () => {
    const first = await social(await idToken());
    expect(first.status).toBe(200);
    expect((await social(await idToken({ email: 'doi-email@example.com' }))).status).toBe(200);
    expect((await admin.query('SELECT u.email, i.provider FROM users u JOIN user_identities i ON i.user_id = u.id')).rows)
      .toEqual([{ email: 'lan@example.com', provider: 'apple' }]);
  });

  it('rejects another audience, another signing key, a wrong nonce, an expired token', async () => {
    const expired = await new SignJWT({ nonce: createHash('sha256').update(NONCE).digest('hex') })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://appleid.apple.com').setAudience('vn.example.spa')
      .setSubject('x').setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(signingKey);
    for (const token of [await idToken({}, signingKey, 'com.other.app'), await idToken({}, strangerKey), expired]) {
      const res = await social(token);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('id_token_invalid');
    }
    expect((await social(await idToken(), 'mot-nonce-khac-0123456789')).status).toBe(401);
    expect((await social(await idToken(), createHash('sha256').update(NONCE).digest('hex'))).status).toBe(401);   // hash sent as raw
  });

  it('an unverified email is not linked to an existing account', async () => {
    await admin.query("INSERT INTO users (id, email) VALUES ($1, 'lan@example.com')", [randomUUID()]);
    const res = await social(await idToken({ email_verified: false }));
    expect(res.status).toBe(422);
    expect((await admin.query('SELECT count(*)::int AS n FROM user_identities')).rows[0].n).toBe(0);
  });
});
