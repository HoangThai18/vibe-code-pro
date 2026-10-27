// src/db/retry.ts — a deadlock (40P01) aborts the whole transaction: run the whole unit once more
import pg from 'pg';

export async function retryOnDeadlock<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof pg.DatabaseError && err.code === '40P01') return run();
    throw err;
  }
}
