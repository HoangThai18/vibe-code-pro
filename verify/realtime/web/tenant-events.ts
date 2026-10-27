// apps/web/src/realtime/tenant-events.ts
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

// Event type → key group under ['tenant', tenantId, ...]
const groups: Record<string, string> = {
  'appointment.changed': 'appointments',
  'notification.created': 'notifications',
};

type Timer = ReturnType<typeof setTimeout> | undefined;

export function connectTenantEvents(queryClient: QueryClient, tenantId: string, baseUrl = ''): () => void {
  let es: EventSource | undefined;
  let retryTimer: Timer, flushTimer: Timer;
  let failures = 0;
  const pending = new Set<string>();          // '*' = the whole tenant
  // Coalesce bursts (one event per row of a bulk import) into one refetch per group
  const invalidate = (group: string) => {
    pending.add(group);
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined;
      const keys = pending.has('*') ? [['tenant', tenantId]] : [...pending].map((g) => ['tenant', tenantId, g]);
      pending.clear();
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    }, 100);
  };

  const connect = () => {
    es = new EventSource(`${baseUrl}/v1/t/${tenantId}/events`, { withCredentials: true });
    // Every (re)connect may have missed events: refetch what is on screen
    es.addEventListener('open', () => { failures = 0; invalidate('*'); });
    es.addEventListener('resync', () => invalidate('*'));
    es.addEventListener('invalidate', (e) => {
      const { type } = JSON.parse(e.data) as { type: string };
      invalidate(groups[type] ?? '*');        // unknown type (newer server): refetch all
    });
    es.addEventListener('error', () => {
      // Network drop: EventSource reconnects itself. A non-200 answer closes it for good: retry slowly
      if (es?.readyState !== EventSource.CLOSED) return;
      retryTimer = setTimeout(connect, Math.min(60_000, 2_000 * 2 ** failures++));
    });
  };

  connect();
  return () => { es?.close(); clearTimeout(retryTimer); clearTimeout(flushTimer); };
}

// Mount once in the workspace layout: each call opens a connection.
// Workspace switch (new tenantId): the cleanup closes the old stream first.
export function useTenantEvents(tenantId: string, baseUrl = '') {
  const queryClient = useQueryClient();
  useEffect(() => connectTenantEvents(queryClient, tenantId, baseUrl), [queryClient, tenantId, baseUrl]);
}
