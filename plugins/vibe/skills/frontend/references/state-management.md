# Quản lý state và store ở frontend

Phần lớn bug "dữ liệu hiển thị sai/cũ" ở frontend đến từ việc trộn lẫn các loại state, hoặc chép dữ liệu server vào store rồi quên cập nhật. Phân loại trước, rồi mới chọn công cụ.

## Mục lục
1. Phân loại state
2. Chọn công cụ
3. Server state với TanStack Query
4. Client state với Zustand
5. Multi-tenant: đổi workspace và đăng xuất
6. Form
7. SSR (Next.js App Router và tương tự)
8. Test

## 1. Phân loại state

| Loại | Ví dụ | Để ở đâu |
|---|---|---|
| Server state | danh sách khách, chi tiết đơn | thư viện query (cache + đồng bộ với server) |
| URL state | bộ lọc, trang, tab, từ khoá tìm | query string trên URL (chia sẻ link, back/forward chạy đúng) |
| Form state | giá trị đang nhập, lỗi validate | thư viện form |
| UI state cục bộ | modal mở, dropdown | `useState` trong component |
| UI state dùng chung | sidebar thu gọn, theme | store nhỏ (Zustand, Pinia) |
| Phiên | user hiện tại, tenant đang chọn | context hoặc store, lấy từ server |

Quy tắc: mỗi dữ liệu chỉ có **một** nơi lưu. Dữ liệu suy ra được (tổng tiền, số lượng) thì tính ra, không lưu.

## 2. Chọn công cụ

| Stack | Server state | Client state |
|---|---|---|
| React / Next.js | TanStack Query (hoặc SWR) | `useState`, Context cho thứ ít đổi, Zustand khi cần dùng chung |
| Dự án đã dùng Redux | RTK Query | Redux Toolkit |
| Vue / Nuxt | TanStack Query cho Vue (hoặc `useFetch` của Nuxt) | Pinia |
| Angular | HttpClient + signals, hoặc TanStack Query cho Angular | signals, NgRx khi app lớn |
| Svelte / SvelteKit | `load` của SvelteKit, TanStack Query | Svelte stores / runes |

Dự án đang dùng công cụ nào thì theo công cụ đó; đổi store giữa chừng chỉ khi có lý do rõ ràng.

## 3. Server state với TanStack Query (v5)

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type CustomerFilters = { status?: string; cursor?: string };

// Tenant đi trong MỌI request (path hoặc header), server kiểm membership ở từng request.
// Đừng để request dựa vào "tenant hiện tại" trong cookie phiên: tab khác đổi tenant là
// request mang key của A nhận về dữ liệu của B, và cache lưu nhầm dưới key của A.
export const api = {
  listCustomers: (tenantId: string, filters: CustomerFilters, signal?: AbortSignal) =>
    http.get<CustomerPage>(`/t/${tenantId}/customers`, { params: filters, signal }),
  createCustomer: (tenantId: string, input: CreateCustomerInput) =>
    http.post<Customer>(`/t/${tenantId}/customers`, input),
};

// Key factory: mọi key bắt đầu bằng tenant, kèm tham số
export const customerKeys = {
  all: (tenantId: string) => ['tenant', tenantId, 'customers'] as const,
  list: (tenantId: string, filters: CustomerFilters) =>
    [...customerKeys.all(tenantId), 'list', filters] as const,
  detail: (tenantId: string, id: string) => [...customerKeys.all(tenantId), 'detail', id] as const,
};

export function useCustomers(tenantId: string, filters: CustomerFilters) {
  return useQuery({
    queryKey: customerKeys.list(tenantId, filters),
    // key và request dựng từ cùng tenantId, filters nên không lệch nhau; signal để huỷ được
    queryFn: ({ signal }) => api.listCustomers(tenantId, filters, signal),
    // Giữ trang cũ trong lúc tải trang mới, nhưng CHỈ khi vẫn cùng tenant. keepPreviousData trần
    // giữ dữ liệu qua mọi lần đổi key, kể cả đổi tenant: workspace B hiện khách của A trong lúc tải.
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

- Sau mutation: invalidate đúng nhóm key liên quan; không tự sửa tay cache ở nhiều chỗ.
- Optimistic update (thao tác cần cảm giác tức thì như tick việc): cập nhật cache trong `onMutate`, lưu snapshot, khôi phục trong `onError`, invalidate trong `onSettled`.
- Lỗi API hiển thị theo `code` trong format lỗi chung của contract, đúng chỗ (theo field với lỗi validate).

## 4. Client state với Zustand

```ts
import { create } from 'zustand';

type UiState = { sidebarOpen: boolean; toggleSidebar: () => void; reset: () => void };

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  reset: () => set({ sidebarOpen: true }),
}));

// Chọn đúng phần cần dùng để tránh re-render thừa
const sidebarOpen = useUiStore((s) => s.sidebarOpen);
```

- Store nhỏ, theo tính năng; không dồn mọi thứ vào một store khổng lồ.
- Chỉ persist (localStorage) những thứ an toàn và cần nhớ (theme, sidebar). Không persist token, dữ liệu cá nhân, dữ liệu của tenant.

## 5. Multi-tenant: đổi workspace và đăng xuất

Bug thật hay gặp: đổi sang workspace B mà trong vài giây vẫn thấy danh sách của workspace A (cache cũ), hoặc request của A trả về muộn và đè lên màn hình của B. Cách chặn tận gốc: tenant nằm trong URL (`/t/{tenantId}/...`), trong query key và trong request (mục 3). Khi đó đổi workspace chỉ là điều hướng: trang mới dùng key mới, gửi request mới, không thể đọc nhầm cache của tenant cũ.

```ts
async function switchTenant(prevTenantId: string, nextTenantId: string) {
  router.replace(`/t/${nextTenantId}`);                                     // 1. sang trang của tenant mới
  await queryClient.cancelQueries({ queryKey: ['tenant', prevTenantId] }); // 2. huỷ request còn chạy của tenant cũ
  queryClient.removeQueries({ queryKey: ['tenant', prevTenantId] });       // 3. bỏ cache của tenant cũ
  useUiStore.getState().reset();                                           // 4. reset store có dữ liệu theo tenant
}
```

- Bước 2–4 không quyết định tính đúng (key đã tách theo tenant); chúng giải phóng bộ nhớ và không để dữ liệu tenant cũ nằm lại trên máy.
- Dự án cũ để tenant trong phiên server (cookie) và chưa chuyển sang URL được: gọi API đổi tenant, **rồi tải lại cả trang** (`window.location.assign('/')`). Đừng chỉ `clear()` cache trong khi các query của trang cũ còn mount: lần render tiếp theo chúng fetch lại, nhận dữ liệu của tenant mới và lưu dưới key của tenant cũ. Cách này cũng không chạy đúng khi mở nhiều tab với tenant khác nhau.
- Đăng xuất: `queryClient.clear()`, reset mọi store, xoá state phiên, rồi tải lại trang đăng nhập.
- Test kịch bản này (mục 8 và e2e): đổi workspace, dữ liệu tenant cũ không còn hiển thị, kể cả khi request cũ trả về chậm.

## 6. Form

- Dùng thư viện form (React Hook Form, VeeValidate, Angular Reactive Forms) với schema validate dùng chung từ contract (vd zod), để FE và BE cùng một luật.
- Hiển thị lỗi server theo field; nút submit chống bấm đúp (disabled khi đang gửi; request tạo mới có idempotency key nếu API hỗ trợ).
- Sửa bản ghi: gửi kèm `version` nếu API có optimistic locking.

## 7. SSR (Next.js App Router và tương tự)

- Dữ liệu cần cho lần hiển thị đầu thì lấy ở server component hoặc loader; tương tác phía client mới cần thư viện query.
- Khi dùng cả hai: prefetch ở server rồi hydrate cache ở client (`HydrationBoundary`), đừng fetch hai lần.
- **Không đặt `QueryClient` hay store ở module scope phía server**: một biến dùng chung cho mọi request, dữ liệu của user này lẫn sang response của user khác. Tạo theo request:

```ts
import { QueryClient, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) return makeQueryClient();             // server: mỗi request một client
  return (browserQueryClient ??= makeQueryClient());  // trình duyệt: một client cho cả phiên
}
```

- Store Zustand được đọc trong lúc SSR: tạo bằng `createStore` cho từng request và đưa xuống qua Context provider, theo hướng dẫn Next.js trong tài liệu Zustand hiện hành.

## 8. Test

- Hook dùng TanStack Query: bọc bằng `QueryClientProvider` với `QueryClient` mới cho mỗi test (`retry: false`).
- Mock API bằng MSW theo contract, không mock chính hook đang test.
- Test kịch bản đổi tenant: dữ liệu tenant cũ không còn hiển thị (luồng đầy đủ trên trình duyệt: skill `build`, `references/e2e-playwright.md`; từ file này: `../../build/references/e2e-playwright.md`).
