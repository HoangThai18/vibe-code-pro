// test/rate-limit.test.ts — DB thật
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';
import { hitRateLimit } from '../src/security/rate-limit';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
after(() => pool.end());

test('50 request song song, giới hạn 10: đúng 10 request được qua', async () => {
  const key = `login:ip:203.0.113.${Math.floor(Math.random() * 255)}`;
  const results = await Promise.all(Array.from({ length: 50 }, () => hitRateLimit(pool, key, 10, 60)));
  assert.equal(results.filter((r) => r.allowed).length, 10);
  const blocked = results.find((r) => !r.allowed)!;
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
});

test('mỗi khoá đếm riêng', async () => {
  const a = await hitRateLimit(pool, `ai:user:${Math.random()}`, 1, 60);
  const b = await hitRateLimit(pool, `ai:user:${Math.random()}`, 1, 60);
  assert.equal(a.allowed && b.allowed, true);
});
