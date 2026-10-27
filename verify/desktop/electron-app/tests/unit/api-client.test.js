// tests/unit/api-client.test.js (node --test tests/unit/*.test.js: plain Node, no Electron)
const assert = require('node:assert/strict');
const test = require('node:test');
const { ApiError, appPlatform, createApiClient } = require('../../api-client.js');

function client(responses, deps = {}) {
  const calls = [];
  const api = createApiClient(
    { baseUrl: 'https://api.example.vn', getAccessToken: () => 'a1', refreshSession: async () => 'refreshed', onUpdateRequired() {}, ...deps },
    { fetch: async (url, init) => { calls.push({ url, headers: init.headers }); return responses.shift(); }, version: '2.3.0', platform: 'windows' },
  );
  return { api, calls };
}

test('maps the OS to the x-app-platform values the server knows', () => {
  assert.equal(appPlatform('darwin'), 'macos');
  assert.equal(appPlatform('win32'), 'windows');
  assert.equal(appPlatform('linux'), 'linux');
  assert.throws(() => appPlatform('freebsd'), /Unsupported platform/);
});

test('every request sends the app version, platform and token', async () => {
  const { api, calls } = client([Response.json({ data: [] })]);
  assert.deepEqual(await api('/v1/t/t1/customers'), { data: [] });
  assert.equal(calls[0].url, 'https://api.example.vn/v1/t/t1/customers');
  assert.equal(calls[0].headers['x-app-version'], '2.3.0');
  assert.equal(calls[0].headers['x-app-platform'], 'windows');
  assert.equal(calls[0].headers.authorization, 'Bearer a1');
});

test('401: refreshes once and retries', async () => {
  const { api, calls } = client([new Response(null, { status: 401 }), Response.json({ data: [] })]);
  assert.deepEqual(await api('/v1/t/t1/customers'), { data: [] });
  assert.equal(calls.length, 2);
});

test('426: starts the update flow and throws app_update_required', async () => {
  let updates = 0;
  const { api } = client([Response.json({ error: { code: 'app_update_required' } }, { status: 426 })], { onUpdateRequired: () => updates++ });
  await assert.rejects(api('/v1/t/t1/customers'), (e) => e instanceof ApiError && e.status === 426 && e.code === 'app_update_required');
  assert.equal(updates, 1);
});
