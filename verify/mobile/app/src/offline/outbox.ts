// src/offline/outbox.ts
import type { RefreshResult } from '../auth/session';

export type PendingWrite = {
  id: string;                        // used as the Idempotency-Key
  tenantId: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;                      // e.g. /v1/t/<tenantId>/customers
  body: unknown;
  attempts: number;
};

export interface OutboxStore {
  add(write: PendingWrite): Promise<void>;
  list(): Promise<PendingWrite[]>;   // in insertion order
  remove(id: string): Promise<void>;
  bumpAttempts(id: string): Promise<void>;
}

export type FlushResult = {
  // auth-required, update-required: stopped with the queue kept; it is sent after login, or by the updated app
  status: 'done' | 'offline' | 'retry-later' | 'auth-required' | 'update-required';
  rejected: { write: PendingWrite; status: number }[];   // permanently rejected by the server: tell the user
};

export type FlushDeps = {
  send: (write: PendingWrite) => Promise<Response>;      // reads the current access token on every call
  refreshSession: () => Promise<RefreshResult>;
  onUpdateRequired: () => void;
};

// The server will never accept these: drop the write and report it. Every other error keeps it.
const REJECTED = new Set([400, 403, 404, 409, 422]);

export async function flushOutbox(store: OutboxStore, deps: FlushDeps): Promise<FlushResult> {
  const rejected: FlushResult['rejected'] = [];
  let refreshed = false;
  for (const write of await store.list()) {
    let res: Response;
    try {
      res = await deps.send(write);
      if (res.status === 401 && !refreshed) {
        refreshed = true;                                  // at most one refresh per flush
        const result = await deps.refreshSession();
        if (result === 'unavailable') return { status: 'retry-later', rejected };
        if (result === 'refreshed') res = await deps.send(write);
      }
    } catch {
      return { status: 'offline', rejected };              // offline: stop, keep order
    }
    if (res.ok) {
      await store.remove(write.id);
    } else if (res.status === 401) {
      return { status: 'auth-required', rejected };        // session gone: keep the queue for after login
    } else if (res.status === 426) {
      deps.onUpdateRequired();
      return { status: 'update-required', rejected };
    } else if (REJECTED.has(res.status)) {
      await store.remove(write.id);                        // invalid data, no permission, record gone, conflict
      rejected.push({ write, status: res.status });
    } else {
      await store.bumpAttempts(write.id);                  // 5xx, 408, 425, 429, anything else: retry later, never skip ahead
      return { status: 'retry-later', rejected };
    }
  }
  return { status: 'done', rejected };
}
