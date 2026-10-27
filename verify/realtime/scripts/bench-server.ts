// Server process for bench-streams: one app instance, reports memory on request
import { startApp } from '../src/server';
import { APP_URL, pool, seed, waitFor } from '../test/helpers';

const app = await startApp({ pool, databaseUrl: APP_URL, sse: { maxPerUser: 100_000 } });
await waitFor(() => app.listener.isReady());
const ctx = await seed();
const mem = () => { globalThis.gc?.(); const m = process.memoryUsage(); return { rss: m.rss, heap: m.heapUsed, streams: app.hub.count() }; };
process.on('message', async (msg: string) => {
  if (msg === 'mem') process.send!({ type: 'mem', ...mem() });
  if (msg === 'stop') { await app.close(); await pool.end(); process.exit(0); }
});
process.send!({ type: 'ready', baseUrl: app.baseUrl, sid: ctx.sid.recep, ...mem() });
