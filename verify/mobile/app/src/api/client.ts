// src/api/client.ts
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { getAccessToken, refreshSession } from '../auth/session';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

let onUpdateRequired: () => void = () => {};
export const setUpdateRequiredHandler = (fn: () => void) => { onUpdateRequired = fn; };

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-app-version': Application.nativeApplicationVersion ?? '0.0.0',
      'x-app-platform': Platform.OS,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && !retried && (await refreshSession())) return api<T>(path, init, true);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code: string = body?.error?.code ?? 'unknown_error';
    if (code === 'app_update_required') onUpdateRequired();   // chuyển sang màn hình cập nhật
    throw new ApiError(res.status, code, body?.error?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Ví dụ: tenant trong path, như web
export const customersApi = {
  list: (tenantId: string) => api<{ data: { id: string; name: string }[] }>(`/v1/t/${tenantId}/customers`),
};
