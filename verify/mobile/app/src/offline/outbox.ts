// src/offline/outbox.ts
export type PendingWrite = {
  id: string;                        // dùng làm Idempotency-Key
  tenantId: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;                      // vd /v1/t/<tenantId>/customers
  body: unknown;
  attempts: number;
};

export interface OutboxStore {
  add(write: PendingWrite): Promise<void>;
  list(): Promise<PendingWrite[]>;   // theo thứ tự thêm vào
  remove(id: string): Promise<void>;
  bumpAttempts(id: string): Promise<void>;
}

export type FlushResult = {
  status: 'done' | 'offline' | 'retry-later';
  rejected: { write: PendingWrite; status: number }[];   // server từ chối hẳn: báo user
};

export async function flushOutbox(
  store: OutboxStore,
  send: (write: PendingWrite) => Promise<Response>,
): Promise<FlushResult> {
  const rejected: FlushResult['rejected'] = [];
  for (const write of await store.list()) {
    let res: Response;
    try {
      res = await send(write);
    } catch {
      return { status: 'offline', rejected };              // mất mạng: dừng, giữ nguyên thứ tự
    }
    if (res.ok) {
      await store.remove(write.id);
    } else if (res.status >= 500 || res.status === 429) {
      await store.bumpAttempts(write.id);
      return { status: 'retry-later', rejected };          // lỗi tạm thời: thử lại sau, không nhảy cóc
    } else {
      await store.remove(write.id);                        // 4xx: hết quyền, xung đột, dữ liệu sai
      rejected.push({ write, status: res.status });
    }
  }
  return { status: 'done', rejected };
}

export const sendWrite = (apiUrl: string, token: string | null) => (write: PendingWrite) =>
  fetch(`${apiUrl}${write.path}`, {
    method: write.method,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': write.id,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: write.method === 'DELETE' ? undefined : JSON.stringify(write.body),
  });
