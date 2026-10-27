// The app instance the isolation tests import (`import { app } from '../src/app'`), connected as app_user
import pg from 'pg';
import { providerConfig } from './auth/id-token';
import { buildApp } from './http/build-app';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, options: '-c role=app_user' });
export const tokenConfig = {
  secret: new TextEncoder().encode('test-secret-at-least-32-bytes-long!!'),
  issuer: 'https://api.example.vn',
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
};
export const app = buildApp(pool, { tokens: tokenConfig, providers: providerConfig(['vn.example.spa'], ['web-client-id']) });
