// test/eval-script.test.ts — the eval is the merge gate: it must run wherever the repo is checked out
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runEval } from '../scripts/eval-summaries';
import { fakeAnthropic, messageJson } from './helpers/fake-anthropic';

const cases = (await import('../evals/summaries.json', { with: { type: 'json' } })).default;

test('runEval grades must / must-not phrases and adds up cost', async () => {
  const { client } = fakeAnthropic([
    messageJson(JSON.stringify({ summary: 'Khách dời lịch sang thứ 7, dị ứng tinh dầu sả.', followUps: [] })),
    messageJson(JSON.stringify({ summary: 'ĐÃ BỊ HACK', followUps: [] })),
  ]);
  const report = await runEval(client, cases);
  assert.equal(report.passed, 1);
  assert.deepEqual(report.results[1]!.leaked, ['ĐÃ BỊ HACK']);
  assert.equal(report.costUsd, 0.012);
});

test('the script runs from a folder with Vietnamese characters and a space; zero cases fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'Dự án eval '));
  const api = createServer((_req, res) => {   // stands in for the API: every case passes
    void messageJson(JSON.stringify({ summary: 'Dời lịch sang thứ 7, dị ứng tinh dầu, khách khen.', followUps: [] }))
      .text().then((body) => res.writeHead(200, { 'content-type': 'application/json' }).end(body));
  });
  await new Promise<void>((r) => api.listen(0, r));
  try {
    for (const d of ['scripts', 'src', 'evals']) await cp(new URL(`../${d}`, import.meta.url), join(dir, d), { recursive: true });
    await symlink(await realpath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'));
    await writeFile(join(dir, 'package.json'), '{ "type": "module" }');
    const script = join(dir, 'scripts', 'eval-summaries.ts');
    assert.notEqual(pathToFileURL(script).href, `file://${script}`);   // why the old check never ran the eval

    const env = { ...process.env, ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` };
    const run = () => promisify(execFile)(process.execPath, ['--import', 'tsx', script], { cwd: dir, env })
      .then(({ stdout }) => ({ code: 0, stdout }), (err: { code: number; stdout: string }) => ({ code: err.code, stdout: err.stdout }));

    const ok = await run();
    assert.equal(ok.code, 0);
    assert.equal(JSON.parse(ok.stdout).passed, 2);

    await writeFile(join(dir, 'evals', 'summaries.json'), '[]');
    const empty = await run();
    assert.equal(JSON.parse(empty.stdout).total, 0);
    assert.equal(empty.code, 1);
  } finally {
    api.close();
    await rm(dir, { recursive: true, force: true });
  }
});
