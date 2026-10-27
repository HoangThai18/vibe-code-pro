// apps/api/src/imports/worker.ts — runs in the worker process (the vibe-backend skill, references/jobs.md)
import type { PgBoss } from 'pg-boss';
import type { Pool } from 'pg';
import { applyBatch } from './apply';
import { markFailed, purgeBatch, Q, type ImportJob } from './service';

const RETRY_LIMIT = 3;

// createQueue does nothing if the queue exists: change options of a live queue with boss.updateQueue
export async function setupImportQueues(boss: PgBoss, opts = { heartbeatSeconds: 30, retryDelay: 30 }) {
  await boss.createQueue(Q.apply, {
    retryLimit: RETRY_LIMIT, retryDelay: opts.retryDelay, retryBackoff: true,
    heartbeatSeconds: opts.heartbeatSeconds,   // worker killed mid-file: retried once heartbeats stop, resumes at next_row
    expireInSeconds: 3600,
  });
  await boss.createQueue(Q.purge, { retryLimit: 5, retryBackoff: true });
}

export async function startImportWorker(boss: PgBoss, pool: Pool, opts?: { heartbeatSeconds: number; retryDelay: number }) {
  await setupImportQueues(boss, opts);
  await boss.work<ImportJob>(Q.apply, { localConcurrency: 2 }, async ([job]) => {
    try {
      await applyBatch(pool, job!.data);
    } catch (err) {
      if (job!.retryCount >= RETRY_LIMIT) await markFailed(pool, job!.data);   // last attempt: UI offers "Thử lại"
      throw err;                                                               // logged by pg-boss: no row contents in it
    }
  });
  await boss.work<ImportJob>(Q.purge, async ([job]) => purgeBatch(pool, job!.data));
}
