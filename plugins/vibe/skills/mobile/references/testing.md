# Test app mobile

Nguyên tắc chung giữ như skill `build` (`testing.md`; từ file này: `../../build/references/testing.md`): test ở mức rẻ nhất bắt được lỗi, người viết tính năng viết luôn test. Khác web ở chỗ E2E cần simulator, emulator hoặc thiết bị, chậm và tốn hơn, nên càng phải đẩy logic xuống unit test.

## Mục lục
1. Chọn mức test
2. Unit và component (jest-expo, React Native Testing Library)
3. E2E bằng Maestro
4. Chạy trong CI
5. Ma trận thiết bị và điều kiện mạng
6. Flutter

## 1. Chọn mức test

| Cần kiểm | Mức | Chạy ở |
|---|---|---|
| Logic thuần: tính tiền, chuyển trạng thái, hàng đợi offline, làm mới token | Unit (Jest) | Máy dev, CI Linux, vài giây |
| Màn hình: hiển thị đủ state, validate form, gọi đúng API | Component (React Native Testing Library) | Máy dev, CI Linux |
| Luồng xuyên nhiều màn trên app thật: đăng nhập, đổi workspace, tạo lịch hẹn | E2E (Maestro) | Simulator/emulator, CI có máy ảo |
| Push, deep link, quyền, camera | Thử tay trên thiết bị thật theo checklist trước release | Thiết bị |

## 2. Unit và component (jest-expo, React Native Testing Library)

```bash
npx expo install jest-expo jest @types/jest @testing-library/react-native --dev
```

`package.json`: `"jest": { "preset": "jest-expo", "testTimeout": 15000 }`, `"scripts": { "test": "jest" }`. `tsconfig.json`: thêm `"types": ["jest"]` vào `compilerOptions` (TypeScript 6, bản đi kèm Expo SDK 58, không tự nạp `@types/*` nữa; thiếu dòng này thì `tsc` báo không biết `test`, `expect`). `testTimeout` cao hơn mặc định 5 giây vì lần chạy đầu trên CI (chưa có cache) mất vài giây để biên dịch các component như `FlatList`.

Logic thuần như hàng đợi ghi (`app-data.md` mục 6) test không cần React Native:

```ts
// src/offline/outbox.test.ts
import { flushOutbox, type OutboxStore, type PendingWrite } from './outbox';

function memoryStore(items: PendingWrite[]): OutboxStore & { items: PendingWrite[] } {
  const store = {
    items: [...items],
    async add(w: PendingWrite) { store.items.push(w); },
    async list() { return [...store.items]; },
    async remove(id: string) { store.items = store.items.filter((w) => w.id !== id); },
    async bumpAttempts(id: string) { store.items = store.items.map((w) => (w.id === id ? { ...w, attempts: w.attempts + 1 } : w)); },
  };
  return store;
}

const write = (id: string): PendingWrite => ({ id, tenantId: 't1', method: 'POST', path: '/v1/t/t1/customers', body: { name: id }, attempts: 0 });
const status = (code: number) => new Response(null, { status: code });

test('gửi theo thứ tự, mất mạng thì dừng và giữ phần còn lại', async () => {
  const store = memoryStore([write('a'), write('b'), write('c')]);
  const sent: string[] = [];
  const result = await flushOutbox(store, async (w) => {
    if (w.id === 'b') throw new TypeError('Network request failed');
    sent.push(w.id);
    return status(201);
  });
  expect(result.status).toBe('offline');
  expect(sent).toEqual(['a']);
  expect(store.items.map((w) => w.id)).toEqual(['b', 'c']);
});

test('lỗi 5xx: thử lại sau, không nhảy sang thao tác sau', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, async () => status(503));
  expect(result.status).toBe('retry-later');
  expect(store.items.map((w) => [w.id, w.attempts])).toEqual([['a', 1], ['b', 0]]);
});

test('4xx: bỏ khỏi hàng đợi và báo lại để hiện cho user', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, async (w) => status(w.id === 'a' ? 409 : 201));
  expect(result.status).toBe('done');
  expect(result.rejected.map((r) => [r.write.id, r.status])).toEqual([['a', 409]]);
  expect(store.items).toEqual([]);
});
```

Component test: render màn hình, tìm phần tử theo chữ và vai trò như người dùng thấy (giống Playwright), mock tầng API chứ không mock component đang test.

```tsx
// src/features/customers/customer-list.tsx
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { customersApi } from '../../api/client';

export function CustomerList({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: ['tenant', tenantId, 'customers'], queryFn: () => customersApi.list(tenantId) });
  if (q.isPending) return <ActivityIndicator accessibilityLabel="Đang tải" />;
  if (q.isError) {
    return (
      <View>
        <Text>Không tải được danh sách.</Text>
        <Pressable accessibilityRole="button" onPress={() => q.refetch()}>
          <Text>Thử lại</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      data={q.data.data}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <Text>{item.name}</Text>}
      ListEmptyComponent={<Text>Chưa có khách nào.</Text>}
    />
  );
}
```

```tsx
// src/features/customers/customer-list.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { CustomerList } from './customer-list';
import { customersApi } from '../../api/client';

jest.mock('../../api/client', () => ({ customersApi: { list: jest.fn() } }));

function renderWithQuery(ui: React.ReactElement) {
  // gcTime: Infinity để Query không đặt hẹn giờ dọn cache 5 phút, nếu không Jest không thoát sau khi test xong
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

test('hiện danh sách khách của đúng workspace', async () => {
  jest.mocked(customersApi.list).mockResolvedValue({ data: [{ id: 'c1', name: 'Nguyễn Thị Lan' }] });
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Nguyễn Thị Lan')).toBeOnTheScreen();
  expect(customersApi.list).toHaveBeenCalledWith('spa-a');
});

test('API lỗi thì hiện thông báo và nút thử lại', async () => {
  jest.mocked(customersApi.list).mockRejectedValue(new Error('boom'));
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Không tải được danh sách.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
});
```

- Module native (`expo-secure-store`, `expo-sqlite`...) không chạy trong Jest: tách logic ra khỏi chỗ gọi native (như `OutboxStore`), hoặc dùng mock mà `jest-expo` có sẵn. Phần gọi native thật thì kiểm bằng E2E.
- Từ React Native Testing Library 14, `render` trả về Promise: luôn `await render(...)`. Matcher như `toBeOnTheScreen` có sẵn khi import thư viện, không cần file setup.
- Các đoạn code ở mục này đã chạy với Expo SDK 58, jest-expo 58, React Native Testing Library 14 và `tsc` strict: 5/5 test pass cả khi chưa có cache, Jest thoát ngay sau khi xong.

## 3. E2E bằng Maestro

Maestro viết luồng bằng YAML, tìm phần tử theo chữ hiển thị và accessibility label, tự chờ phần tử xuất hiện. Cài: `curl -fsSL "https://get.maestro.mobile.dev" | bash` (cần Java 17+). Chạy được trên Android emulator, iOS simulator; chưa chạy trên iPhone thật.

```yaml
# .maestro/switch-workspace.yaml
appId: vn.example.spacrm.preview      # bundle id của biến thể đang test (release.md mục 1)
---
- launchApp:
    clearState: true
- tapOn: "Email"
- inputText: ${E2E_EMAIL}
- tapOn: "Mật khẩu"
- inputText: ${E2E_PASSWORD}
- tapOn: "Đăng nhập"
- assertVisible: "Nguyễn Thị A1"
- tapOn: "Workspace"
- tapOn: "Spa Bạch Dương"
- assertVisible: "Trần Văn B1"
- assertNotVisible: "Nguyễn Thị A1"
```

```bash
maestro test -e E2E_EMAIL=multi@example.test -e E2E_PASSWORD="$E2E_PASSWORD" .maestro/switch-workspace.yaml
```

- Chạy với development build hoặc bản build preview trỏ vào môi trường staging có dữ liệu seed, giống E2E web (skill `build`, `e2e-playwright.md` mục 3–4).
- Thêm `accessibilityLabel` cho phần tử khó tìm theo chữ (icon); đó cũng là việc a11y cần làm.
- Detox là lựa chọn khác (test viết bằng JS, đồng bộ với trạng thái app tốt), cài đặt phức tạp hơn; dự án đã dùng thì theo dự án.

## 4. Chạy trong CI

- Unit và component: job Linux bình thường cùng CI của web (skill `ship`, `ci-cd.md`).
- E2E Android: runner Linux với Android emulator (vd action `reactivecircus/android-emulator-runner`), cài bản build `.apk` preview, chạy Maestro. E2E iOS: runner macOS với simulator. Cả hai chậm: chạy cho luồng chính, hằng đêm và trước release, không nhất thiết mỗi PR.
- Hoặc dùng dịch vụ có sẵn (EAS Workflows, Maestro Cloud, BrowserStack...) khi không muốn tự giữ máy ảo.

## 5. Ma trận thiết bị và điều kiện mạng

Trước mỗi bản phát hành, đi luồng chính trên:

- iOS: bản iOS tối thiểu đang hỗ trợ và bản mới nhất; một máy màn hình nhỏ.
- Android: một máy tầm trung, phiên bản Android tối thiểu (`minSdkVersion`) và bản mới nhất; một máy có màn hình nhỏ.
- Mạng: offline hẳn, mạng chậm (Network Link Conditioner trên iOS, giả lập mạng chậm của Android emulator), mất mạng giữa lúc gửi form.
- Cỡ chữ lớn nhất, chế độ tối, tiếng Việt có dấu trong mọi ô nhập.

## 6. Flutter

`flutter_test` cho unit và widget test (chạy không cần thiết bị), golden test để so ảnh widget, `integration_test` cho luồng trên thiết bị/emulator; Maestro cũng chạy được với app Flutter. Nguyên tắc chọn mức test như mục 1.
