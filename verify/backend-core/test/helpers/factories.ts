// Seeds through the app's own code: users and tenants as sign-up does, customers through the API
import argon2 from 'argon2';
import request from 'supertest';
import { app, pool } from '../../src/app';
import { createTenant } from '../../src/db/tenant';

export const PASSWORD = 'mot-mat-khau-du-dai';
let seq = 0;

export async function createUser(prefix: string) {
  const email = `${prefix}-${process.pid}-${seq++}@example.com`;
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, await argon2.hash(PASSWORD)]);
  return { userId: rows[0]!.id, email };
}

export async function login(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data as { accessToken: string; refreshToken: string; expiresIn: number };
}

export async function createTenantWithUser(name: string) {
  const { userId, email } = await createUser(name);
  const tenantId = await createTenant(pool, userId, name);
  return { tenantId, userId, token: (await login(email)).accessToken };
}

export async function createCustomer(t: { tenantId: string; token: string }, body: { fullName: string; phone: string; email?: string }) {
  const res = await request(app).post(`/v1/t/${t.tenantId}/customers`).set('Authorization', `Bearer ${t.token}`).send(body);
  if (res.status !== 201) throw new Error(`createCustomer ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; fullName: string };
}
