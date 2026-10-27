// apps/api/src/realtime/pg-listener.ts — one dedicated connection per instance, never from the pool
import pg from 'pg';
import type { AppEvent, Hub } from './hub';

export function listenForEvents(opts: { connectionString: string; hub: Hub }) {
  let client: pg.Client | undefined;
  let ready = false, stopped = false, failures = 0;
  let pending = Promise.resolve();
  const start = () => { pending = connect(); };

  async function connect(): Promise<void> {
    if (stopped) return;
    const c = new pg.Client({ connectionString: opts.connectionString, keepAlive: true, application_name: 'realtime-listener' });
    let retried = false;
    const retry = (err?: unknown) => {
      ready = false;
      if (stopped || retried) return;
      retried = true;
      console.error('realtime listener down', err);   // the project's logger
      setTimeout(start, Math.min(30_000, 500 * 2 ** failures++) * (0.5 + Math.random() / 2));
    };
    c.on('error', retry).on('end', () => retry());
    c.on('notification', (msg) => {
      try {
        if (msg.channel === 'app_events') opts.hub.publish(JSON.parse(msg.payload ?? '') as AppEvent);
      } catch (err) {
        console.error('bad realtime payload', err);   // any DB session may NOTIFY: a forged event costs a refetch
      }
    });
    try {
      await c.connect();
      await c.query('LISTEN app_events');
      client = c;
      ready = true;
      failures = 0;
      opts.hub.resyncAll();     // events sent while we were not listening are lost
    } catch (err) {
      retry(err);
      c.end().catch(() => {});
    }
  }

  start();
  return {
    isReady: () => ready,       // readiness check: no traffic before LISTEN is active
    stop: async () => {
      stopped = true;
      await pending;            // let a connect in progress finish
      await client?.end();
    },
  };
}
