import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export type CustomerHit = { id: string; fullName: string };

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function useCustomerSearch(tenantId: string, input: string) {
  const q = useDebouncedValue(input.trim(), 250);  // one request per pause, not per keystroke
  return useQuery({
    queryKey: ['tenant', tenantId, 'customers', 'search', q],
    // signal: when q changes, TanStack Query aborts the request for the old q
    queryFn: async ({ signal }): Promise<CustomerHit[]> => {
      const res = await fetch(`/v1/t/${tenantId}/customers/search?q=${encodeURIComponent(q)}`, { signal });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return ((await res.json()) as { data: CustomerHit[] }).data;
    },
    enabled: q.length >= 2,
    // Keep the old results while the next ones load, but never across workspaces
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === tenantId ? prev : undefined),
    staleTime: 30_000,
  });
}
