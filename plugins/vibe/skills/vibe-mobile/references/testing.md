# Testing mobile apps

General principles as in the `vibe-build` skill (`references/testing.md`): test at the cheapest level that catches the bug; whoever writes the feature writes its tests. Unlike web, E2E needs a simulator, emulator or device and is slower and costlier, so push even more logic into unit tests.

## Contents
1. Choose the test level
2. Unit and component (jest-expo, React Native Testing Library)
3. E2E with Maestro
4. Running in CI
5. Device matrix and network conditions
6. Flutter

## 1. Choose the test level

| What to check | Level | Runs on |
|---|---|---|
| Pure logic: pricing, state transitions, offline queue, token refresh | Unit (Jest) | Dev machine, Linux CI, seconds |
| Screens: all states render, form validation, correct API calls | Component (React Native Testing Library) | Dev machine, Linux CI |
| Multi-screen flows in the real app: login, workspace switch, booking an appointment | E2E (Maestro) | Simulator/emulator, CI with virtual devices |
| Push, deep links, permissions, camera | Manual on real devices from a pre-release checklist | Devices |

## 2. Unit and component (jest-expo, React Native Testing Library)

```bash
npx expo install jest-expo jest @types/jest @testing-library/react-native --dev
```

`package.json`: `"jest": { "preset": "jest-expo", "testTimeout": 15000 }`, `"scripts": { "test": "jest" }`. `tsconfig.json`: add `"types": ["jest"]` to `compilerOptions` (TypeScript 6, shipped with Expo SDK 58, no longer auto-loads `@types/*`; without this line `tsc` does not know `test`, `expect`). `testTimeout` is above the 5-second default because the first CI run (no cache) takes a few seconds to compile components such as `FlatList`.

Pure logic like the write queue (`app-data.md` section 6) is tested without React Native:

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

test('sends in order; stops when offline and keeps the rest', async () => {
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

test('5xx: retry later, never skip to the next write', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, async () => status(503));
  expect(result.status).toBe('retry-later');
  expect(store.items.map((w) => [w.id, w.attempts])).toEqual([['a', 1], ['b', 0]]);
});

test('4xx: removed from the queue and reported to show the user', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, async (w) => status(w.id === 'a' ? 409 : 201));
  expect(result.status).toBe('done');
  expect(result.rejected.map((r) => [r.write.id, r.status])).toEqual([['a', 409]]);
  expect(store.items).toEqual([]);
});
```

Component tests: render the screen, find elements by text and role as the user sees them (like Playwright), mock the API layer, not the component under test.

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
  // gcTime: Infinity so Query sets no 5-minute cache cleanup timer; otherwise Jest does not exit after the tests
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

test('shows customers of the right workspace', async () => {
  jest.mocked(customersApi.list).mockResolvedValue({ data: [{ id: 'c1', name: 'Nguyễn Thị Lan' }] });
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Nguyễn Thị Lan')).toBeOnTheScreen();
  expect(customersApi.list).toHaveBeenCalledWith('spa-a');
});

test('API error shows a message and a retry button', async () => {
  jest.mocked(customersApi.list).mockRejectedValue(new Error('boom'));
  await renderWithQuery(<CustomerList tenantId="spa-a" />);
  expect(await screen.findByText('Không tải được danh sách.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
});
```

- Native modules (`expo-secure-store`, `expo-sqlite`...) do not run in Jest: separate logic from native calls (like `OutboxStore`), or use the mocks `jest-expo` provides. Test the real native calls with E2E.
- Since React Native Testing Library 14, `render` returns a Promise: always `await render(...)`. Matchers like `toBeOnTheScreen` come with the library import; no setup file needed.
- The code in this section was run with Expo SDK 58, jest-expo 58, React Native Testing Library 14 and strict `tsc`: 5/5 tests pass even with no cache, and Jest exits right after.

## 3. E2E with Maestro

Maestro flows are YAML; it finds elements by visible text and accessibility label and waits for them automatically. Install: `curl -fsSL "https://get.maestro.mobile.dev" | bash` (needs Java 17+). Runs on Android emulator and iOS simulator; not yet on real iPhones.

```yaml
# .maestro/switch-workspace.yaml
appId: vn.example.spacrm.preview      # bundle id of the variant under test (release.md section 1)
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

- Run against a development build or a preview build pointing at a staging environment with seed data, as in web E2E (the `vibe-build` skill, `references/e2e-playwright.md` sections 3–4).
- Add `accessibilityLabel` to elements hard to find by text (icons); a11y needs that anyway.
- Detox is an alternative (tests in JS, good sync with app state), harder to set up; if the project already uses it, follow the project.

## 4. Running in CI

- Unit and component: a normal Linux job alongside web CI (the `vibe-ship` skill, `references/ci-cd.md`).
- Android E2E: Linux runner with an Android emulator (e.g. action `reactivecircus/android-emulator-runner`), install the preview `.apk`, run Maestro. iOS E2E: macOS runner with a simulator. Both are slow: run them for main flows, nightly and before release, not necessarily on every PR.
- Or use a hosted service (EAS Workflows, Maestro Cloud, BrowserStack...) if you do not want to maintain virtual devices.

## 5. Device matrix and network conditions

Before each release, walk the main flows on:

- iOS: the minimum supported iOS version and the latest; one small-screen device.
- Android: a mid-range phone, the minimum Android version (`minSdkVersion`) and the latest; one small-screen device.
- Network: fully offline, slow network (Network Link Conditioner on iOS, the Android emulator's slow-network simulation), network lost while submitting a form.
- Largest font size, dark mode, Vietnamese text with diacritics in every input.

## 6. Flutter

`flutter_test` for unit and widget tests (no device needed), golden tests to compare widget images, `integration_test` for flows on device/emulator; Maestro also works with Flutter apps. Choose the level as in section 1.
