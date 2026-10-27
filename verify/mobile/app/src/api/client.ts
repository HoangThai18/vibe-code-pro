// src/api/client.ts
import { appHeaders, notifyUpdateRequired } from './app-version';
import { getAccessToken, refreshSession } from '../auth/session';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...appHeaders(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && !retried) {
    // Another call already refreshed: retry with its token. Otherwise refresh once, shared by concurrent calls.
    const current = getAccessToken();
    if ((current && current !== token) || (await refreshSession()) === 'refreshed') return api<T>(path, init, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code: string = body?.error?.code ?? 'unknown_error';
    if (res.status === 426) notifyUpdateRequired();   // app_update_required: go to the update screen
    throw new ApiError(res.status, code, body?.error?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Example: tenant in the path, as on web
export const customersApi = {
  list: (tenantId: string) => api<{ data: { id: string; fullName: string }[] }>(`/v1/t/${tenantId}/customers`),
};
