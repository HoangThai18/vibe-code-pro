# Frontend state and store management

Most "wrong/stale data on screen" bugs come from mixing kinds of state, or copying server data into a store and forgetting to update it. Classify first, then pick the tool.

## Contents
1. Kinds of state
2. Choosing a tool
3. Server state with TanStack Query
4. Client state with Zustand
5. Multi-tenant: switching workspace and logging out
6. Forms
7. SSR (Next.js App Router and similar)
8. Tests

## 1. Kinds of state

| Kind | Example | Where |
|---|---|---|
| Server state | customer list, order details | query library (cache + sync with server) |
| URL state | filters, page, tab, search term | URL query string (shareable links, back/forward work) |
| Form state | values being typed, validation errors | form library |
| Local UI state | modal open, dropdown | `useState` in the component |
| Shared UI state | collapsed sidebar, theme | small store (Zustand, Pinia) |
| Session | current user, selected tenant | context or store, loaded from the server |

Rule: each piece of data lives in **one** place. Derived data (totals, counts) is computed, not stored.

## 2. Choosing a tool

| Stack | Server state | Client state |
|---|---|---|
| React / Next.js | TanStack Query (or SWR) | `useState`, Context for rarely changing things, Zustand when shared |
| Project already on Redux | RTK Query | Redux Toolkit |
| Vue / Nuxt | TanStack Query for Vue (or Nuxt `useFetch`) | Pinia |
| Angular | HttpClient + signals, or TanStack Query for Angular | signals, NgRx for large apps |
| Svelte / SvelteKit | SvelteKit `load`, TanStack Query | Svelte stores / runes |

Follow whatever the project already uses; switch stores midway only for a clear reason.

## 3. Server state with TanStack Query (v5)

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type CustomerFilters = { status?: string; cursor?: string };

// Tenant goes in EVERY request (path or header); the server checks membership on each request.
// Never rely on the "current tenant" in the session cookie: if another tab switches tenant,
// a request keyed for A receives B's data, and the cache stores it under A's key.
export const api = {
  listCustomers: (tenantId: string, filters: CustomerFilters, signal?: AbortSignal) =>
    http.get<CustomerPage>(`/t/${tenantId}/customers`, { params: filters, signal }),
  createCustomer: (tenantId: string, input: CreateCustomerInput) =>
    http.post<Customer>(`/t/${tenantId}/customers`, input),
};

// Key factory: every key starts with the tenant, then the params
export const customerKeys = {
  all: (tenantId: string) => ['tenant', tenantId, 'customers'] as const,
  list: (tenantId: string, filters: CustomerFilters) =>
    [...customerKeys.all(tenantId), 'list', filters] as const,
  detail: (tenantId: string, id: string) => [...customerKeys.all(tenantId), 'detail', id] as const,
};

export function useCustomers(tenantId: string, filters: CustomerFilters) {
  return useQuery({
    queryKey: customerKeys.list(tenantId, filters),
    // key and request are built from the same tenantId and filters, so they can't diverge; signal makes it cancellable
    queryFn: ({ signal }) => api.listCustomers(tenantId, filters, signal),
    // Keep the previous page while loading the next, but ONLY within the same tenant. Plain keepPreviousData
    // keeps data across every key change, tenant switches included: workspace B shows A's customers while loading.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === tenantId ? prev : undefined),
    staleTime: 30_000,
  });
}

export function useCreateCustomer(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => api.createCustomer(tenantId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.all(tenantId) }),
  });
}
```

- After a mutation: invalidate exactly the related key group; never hand-edit the cache in many places.
- Optimistic updates (actions that must feel instant, like ticking a todo): update the cache in `onMutate`, keep a snapshot, restore it in `onError`, invalidate in `onSettled`.
- Show API errors by the `code` in the contract's shared error format, in the right place (per field for validation errors).

## 4. Client state with Zustand

```ts
import { create } from 'zustand';

type UiState = { sidebarOpen: boolean; toggleSidebar: () => void; reset: () => void };

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  reset: () => set({ sidebarOpen: true }),
}));

// Select only the part you need to avoid extra re-renders
const sidebarOpen = useUiStore((s) => s.sidebarOpen);
```

- Small stores, per feature; don't pile everything into one giant store.
- Persist (localStorage) only safe things worth remembering (theme, sidebar). Never persist tokens, personal data or tenant data.

## 5. Multi-tenant: switching workspace and logging out

A common real bug: after switching to workspace B, workspace A's list still shows for a few seconds (stale cache), or a late response for A overwrites B's screen. Root fix: the tenant is in the URL (`/t/{tenantId}/...`), in the query key and in the request (section 3). Then switching workspace is just navigation: the new page uses new keys and sends new requests, and can never read the old tenant's cache.

```ts
async function switchTenant(prevTenantId: string, nextTenantId: string) {
  router.replace(`/t/${nextTenantId}`);                                     // 1. go to the new tenant's page
  await queryClient.cancelQueries({ queryKey: ['tenant', prevTenantId] }); // 2. cancel the old tenant's in-flight requests
  queryClient.removeQueries({ queryKey: ['tenant', prevTenantId] });       // 3. drop the old tenant's cache
  useUiStore.getState().reset();                                           // 4. reset stores holding tenant data
}
```

- Steps 2–4 don't determine correctness (keys are already split by tenant); they free memory and keep old tenant data off the device.
- Legacy projects that keep the tenant in the server session (cookie) and can't move it to the URL yet: call the switch-tenant API, **then reload the whole page** (`window.location.assign('/')`). Don't just `clear()` the cache while the old page's queries are still mounted: on the next render they refetch, get the new tenant's data and store it under the old tenant's key. This approach also breaks with several tabs on different tenants.
- Logout: `queryClient.clear()`, reset every store, clear session state, then reload to the login page.
- Test this scenario (section 8 and E2E): switch workspace; the old tenant's data no longer shows, even when an old request returns late.

## 6. Forms

- Use a form library (React Hook Form, VeeValidate, Angular Reactive Forms) with a validation schema shared from the contract (e.g. zod), so FE and BE apply the same rules.
- Show server errors per field; prevent double submit (disabled while sending; create requests carry an idempotency key if the API supports it).
- Editing a record: send `version` if the API uses optimistic locking.

## 7. SSR (Next.js App Router and similar)

- Data needed for first render: fetch in a server component or loader; only client-side interaction needs the query library.
- Using both: prefetch on the server, then hydrate the client cache (`HydrationBoundary`); don't fetch twice.
- **Never put a `QueryClient` or store at module scope on the server**: one variable shared by every request leaks one user's data into another user's response. Create per request:

```ts
import { QueryClient, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) return makeQueryClient();             // server: one client per request
  return (browserQueryClient ??= makeQueryClient());  // browser: one client for the whole session
}
```

- Zustand stores read during SSR: create one per request with `createStore` and pass it down through a Context provider, per the Next.js guide in the current Zustand docs.

## 8. Tests

- Hooks using TanStack Query: wrap in `QueryClientProvider` with a new `QueryClient` per test (`retry: false`).
- Mock the API with MSW per the contract; never mock the hook under test.
- Test tenant switching: the old tenant's data no longer shows (full browser flow: the `vibe-build` skill, `references/e2e-playwright.md`).
