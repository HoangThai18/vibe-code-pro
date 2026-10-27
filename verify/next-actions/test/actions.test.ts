// test/actions.test.ts — against `next build` + `next start`, a real PostgreSQL with FORCE RLS
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { A, B, CUSTOMER_A, CUSTOMER_B, USER_A, USER_B, actionId, admin, callAction, page, start, stop } from './server';

before(start);
after(stop);

const list = async (tenant: string, user: string) => {
  const res = await page(`/t/${tenant}/customers`, user);
  const html = await res.text();
  return { status: res.status, html, loadedAt: /data-loaded-at="([^"]+)"/.exec(html)?.[1] };
};
const nameOf = async (id: string) => (await admin.query('SELECT full_name FROM customers WHERE id = $1', [id])).rows[0].full_name;
const rename = (tenant: string, input: unknown, user?: string) =>
  callAction(`/t/${A}/customers`, actionId('renameCustomer'), [tenant, input], user);

test('cached lists never cross tenants; another tenant\'s page shows not-found', async () => {
  const a = await list(A, USER_A);
  const b = await list(B, USER_B);
  assert.ok(a.html.includes('Lan') && !a.html.includes('Mai'));
  assert.ok(b.html.includes('Mai') && !b.html.includes('Lan'));
  assert.equal((await list(A, USER_A)).loadedAt, a.loadedAt);          // served from the cache
  for (const [tenant, user] of [[B, USER_A], [A, '']] as const) {            // not a member; no session
    const denied = await list(tenant, user);                            // streamed: notFound() arrives as 200 + noindex
    assert.ok(denied.loadedAt === undefined && !denied.html.includes('Mai') && denied.html.includes('content="noindex"'));
  }
});

test('the action rejects another tenant\'s id, bad input and no session; data unchanged', async () => {
  const denied = [
    [B, { customerId: CUSTOMER_B, fullName: 'Hacked' }, USER_A, 'not_found'],        // B's tenant id, A's session
    [A, { customerId: CUSTOMER_B, fullName: 'Hacked' }, USER_A, 'not_found'],        // B's customer via A
    [A, { customerId: CUSTOMER_A, fullName: '' }, USER_A, 'invalid_input'],
    [A, { customerId: CUSTOMER_A, fullName: 'X', tenantId: B }, USER_A, 'invalid_input'],
    [A, { customerId: CUSTOMER_A, fullName: 'X' }, undefined, 'unauthenticated'],
  ] as const;
  for (const [tenant, input, user, code] of denied) {
    const res = await rename(tenant, input, user);
    assert.equal(res.status, 200);
    assert.match(res.body, new RegExp(`"code":"${code}"`), JSON.stringify(input));
  }
  assert.equal(await nameOf(CUSTOMER_B), 'Mai');
  assert.equal(await nameOf(CUSTOMER_A), 'Lan');
});

test('a rename refreshes only that tenant\'s cache entry', async () => {
  const b = await list(B, USER_B);
  const res = await rename(A, { customerId: CUSTOMER_A, fullName: 'Lan Anh' }, USER_A);
  assert.match(res.body, /"ok":true/);
  assert.match(res.body, /Lan Anh/);                                    // updateTag: the response re-renders the page
  assert.ok((await list(A, USER_A)).html.includes('Lan Anh'));
  assert.equal((await list(B, USER_B)).loadedAt, b.loadedAt);           // B's entry untouched
});

test('the cached function is not reachable from the browser: its id is in no page or client chunk', async () => {
  const cacheId = actionId('$$RSC_SERVER_CACHE_0');
  const html = (await list(A, USER_A)).html;
  assert.ok(html.includes(actionId('renameCustomer')));                 // the action is public, by design
  assert.ok(!html.includes(cacheId));
  const chunks = readdirSync('.next/static/chunks', { recursive: true }).filter((f) => String(f).endsWith('.js'));
  assert.ok(!chunks.some((f) => readFileSync(`.next/static/chunks/${f}`, 'utf8').includes(cacheId)));
  // Why it matters: posted directly, the cached function runs with any tenant id and checks nothing
  const leak = await callAction(`/t/${A}/customers`, cacheId, [B], USER_A);
  assert.match(leak.body, /"full_name":"Mai"/);
});
