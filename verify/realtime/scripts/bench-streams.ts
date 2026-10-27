// Opens N SSE streams against a server in a child process and reports server memory per stream
import { fork } from 'node:child_process';
import { request, Agent } from 'node:http';
import { A } from '../test/helpers';

const N = Number(process.argv[2] ?? 2000);
const child = fork(new URL('./bench-server.ts', import.meta.url).pathname, [], { execArgv: ['--import', 'tsx', '--expose-gc'] });
const next = () => new Promise<any>((r) => child.once('message', r));
const ready = await next();
const agent = new Agent({ keepAlive: true, maxSockets: Infinity });
const open = () => new Promise<void>((resolve, reject) => {
  const req = request(`${ready.baseUrl}/v1/t/${A}/events`, { agent, headers: { cookie: `sid=${ready.sid}` } }, (res) => {
    if (res.statusCode !== 200) return reject(new Error(String(res.statusCode)));
    res.once('data', () => resolve());
  });
  req.on('error', reject);
  req.end();
});
for (let i = 0; i < N; i += 100) await Promise.all(Array.from({ length: Math.min(100, N - i) }, open));
await new Promise((r) => setTimeout(r, 500));
child.send('mem');
const after = await next();
console.log(JSON.stringify({ N, streams: after.streams, rssPerStreamKB: Math.round((after.rss - ready.rss) / N / 1024 * 10) / 10, heapPerStreamKB: Math.round((after.heap - ready.heap) / N / 1024 * 10) / 10, rssBeforeMB: Math.round(ready.rss / 1048576), rssAfterMB: Math.round(after.rss / 1048576) }));
child.send('stop');
await new Promise((r) => child.once('exit', r));
process.exit(0);
