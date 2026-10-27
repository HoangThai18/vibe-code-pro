// src/offline/flush.ts
import { appHeaders, notifyUpdateRequired } from '../api/app-version';
import { getAccessToken, refreshSession } from '../auth/session';
import { flushOutbox, type FlushResult, type OutboxStore, type PendingWrite } from './outbox';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export function sendWrite(write: PendingWrite): Promise<Response> {
  const token = getAccessToken();   // read per write: a refresh during the flush replaces it
  return fetch(`${API_URL}${write.path}`, {
    method: write.method,
    headers: {
      'content-type': 'application/json',
      ...appHeaders(),
      'idempotency-key': write.id,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: write.method === 'DELETE' ? undefined : JSON.stringify(write.body),
  });
}

let running: Promise<FlushResult> | null = null;

// Network back and app in foreground can fire together: one flush at a time
export function flushPendingWrites(store: OutboxStore): Promise<FlushResult> {
  running ??= flushOutbox(store, { send: sendWrite, refreshSession, onUpdateRequired: notifyUpdateRequired })
    .finally(() => { running = null; });
  return running;
}
