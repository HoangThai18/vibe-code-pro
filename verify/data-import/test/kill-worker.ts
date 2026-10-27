// Child process for the SIGKILL test: a worker that the test kills mid-file
import { PgBoss } from 'pg-boss';
import { startImportWorker } from '../src/imports/worker';
import { APP_URL, appPool } from './helpers';

const boss = new PgBoss(APP_URL);
boss.on('error', () => {});
await boss.start();
await startImportWorker(boss, appPool(), { heartbeatSeconds: 10, retryDelay: 1 });
