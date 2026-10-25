# Test giao diện và luồng người dùng bằng Playwright

Unit test và integration test không thấy được thứ người dùng thấy: nút bấm không phản hồi, màn hình hiện dữ liệu của workspace cũ, form không dùng được bằng bàn phím, nhân viên thấy nút chỉ chủ spa mới được bấm. Playwright chạy trình duyệt thật (Chromium, Firefox, WebKit), tự chờ phần tử sẵn sàng, ghi trace để xem lại từng bước khi fail.

Mọi đoạn code trong file này đã chạy với `@playwright/test` 1.63 trên Chromium, lặp 5 lần với 4 worker song song mà không chập chờn, trên cả bản app huỷ request khi đổi trang và bản có phần tử `role="alert"` sẵn như Next.js. Hai test đổi workspace (mục 7) được chạy với các bản app cố ý cài lỗi và fail mọi lần, tức là chúng bắt được lỗi thật chứ không chỉ pass.

## Mục lục
1. Chọn luồng nào để test
2. Cài đặt và cấu hình
3. Đăng nhập một lần cho mỗi vai trò
4. Fixture: dữ liệu và trình duyệt theo vai trò
5. Viết test bền
6. Luồng nhiều vai trò
7. Đổi workspace và cô lập tenant
8. Thời gian: giờ server và giờ trình duyệt
9. Mock mạng: trạng thái lỗi, response chậm, dịch vụ ngoài
10. So ảnh giao diện
11. Truy cập được (a11y)
12. Debug khi test fail
13. Chạy trong CI
14. Cho Claude điều khiển trình duyệt
15. Trước khi coi là xong

## 1. Chọn luồng nào để test

E2E chậm và tốn công giữ, nên chỉ dành cho luồng mà hỏng là mất tiền hoặc mất khách: đăng nhập, luồng tạo giá trị chính (đặt lịch, tạo đơn), thanh toán, phân quyền theo vai trò, đổi workspace, cô lập tenant. Mỗi phase thêm E2E cho luồng của phase đó.

| Muốn kiểm | Cách rẻ nhất |
|---|---|
| Tính toán, quy tắc nghiệp vụ, state machine | Unit test (`testing.md`) |
| Query, RLS, endpoint, format lỗi | Integration với DB thật |
| Component có logic (form, bảng lọc) | Component test + MSW |
| Luồng xuyên FE và BE, nhiều màn, nhiều vai trò | **E2E Playwright** (file này) |
| Giao diện lệch so với bản chuẩn | `toHaveScreenshot` cho vài màn chính (mục 10) |
| Truy cập được | axe + test bằng bàn phím (mục 11) |

## 2. Cài đặt và cấu hình

```bash
pnpm create playwright                      # hoặc: npm init playwright@latest
pnpm exec playwright install --with-deps chromium
pnpm add -D @axe-core/playwright            # nếu test a11y (mục 11)
```

Bẫy đã gặp: `@axe-core/playwright` khai `playwright-core` là peer dependency, trình quản lý gói có thể cài một bản `playwright-core` mới hơn bản của `@playwright/test`, và TypeScript báo `Type 'Page' is missing the following properties from type 'Page'`. Sửa: thêm `playwright-core` **cùng version** với `@playwright/test` vào devDependencies.

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,          // quên test.only thì CI fail
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',      // giờ của trình duyệt cố định, không theo máy chạy test
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/owner-a.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], storageState: 'tests/e2e/.auth/owner-a.json' },
      dependencies: ['setup'],
      grep: /@mobile/,                     // chỉ chạy test gắn tag @mobile
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? 'pnpm build && pnpm start' : 'pnpm dev',
        url: `http://localhost:${PORT}/health/ready`,   // endpoint readiness (skill ship, observability.md)
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
```

```gitignore
tests/e2e/.auth/
test-results/
playwright-report/
blob-report/
```

- `timezoneId`, `locale` cố định để test không phụ thuộc máy chạy.
- Project `mobile` chỉ chạy test có tag `@mobile` (thêm vào tên test), không nhân đôi cả bộ.
- `E2E_BASE_URL` có giá trị (staging, preview) thì không tự bật server.

## 3. Đăng nhập một lần cho mỗi vai trò

Đăng nhập qua API rồi lưu cookie, nhanh hơn điền form ở mọi test:

```ts
// tests/e2e/auth.setup.ts
// Đăng nhập qua API một lần cho mỗi vai trò, lưu cookie để các test dùng lại.
// Nhanh hơn điền form; luồng đăng nhập bằng form có test riêng (login.spec.ts).
import { test as setup, expect } from '@playwright/test';
import { ROLES, authFile } from './fixtures';

for (const [role, email] of Object.entries(ROLES)) {
  setup(`đăng nhập ${role}`, async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { email, password: process.env.E2E_PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    await request.storageState({ path: authFile(role) });
  });
}
```

Luồng đăng nhập bằng form vẫn cần một test riêng:

```ts
// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } }); // chưa đăng nhập

test('đăng nhập bằng form rồi vào danh sách khách @mobile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner-a@example.test');
  await page.getByLabel('Mật khẩu').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
});

test('sai mật khẩu thì báo lỗi, không vào được', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner-a@example.test');
  await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Sai email hoặc mật khẩu');
  await expect(page).toHaveURL(/\/login$/);
});
```

- File trong `.auth/` chứa cookie phiên: không commit, chỉ dùng tài khoản test trên môi trường test. Không bao giờ chạy E2E bằng tài khoản thật trên production.
- App đăng nhập qua bên thứ ba (Google, Zalo): trên môi trường test thêm một endpoint đăng nhập chỉ bật bằng cờ cấu hình, hoặc dùng tài khoản test của nhà cung cấp; không tự động hoá form đăng nhập của họ.

## 4. Fixture: dữ liệu và trình duyệt theo vai trò

```ts
// tests/e2e/fixtures.ts
import { test as base, expect, type APIRequestContext, type Browser } from '@playwright/test';

export const TENANT_A = 'spa-a';
export const TENANT_B = 'spa-b';

// Tài khoản seed sẵn trên môi trường test; mật khẩu lấy từ biến môi trường E2E_PASSWORD
export const ROLES = {
  'owner-a': 'owner-a@example.test',
  'staff-a': 'staff-a@example.test',
  'owner-b': 'owner-b@example.test',
  multi: 'multi@example.test',          // thành viên của cả hai tenant
} as const;
export type Role = keyof typeof ROLES;

export const authFile = (role: string) => `tests/e2e/.auth/${role}.json`;
export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

type Fixtures = {
  apiAs: (role: Role) => Promise<APIRequestContext>;
  uniqueName: (prefix: string) => string;
  pageAs: (role: Role) => ReturnType<Browser['newPage']>;
};

export const test = base.extend<Fixtures>({
  // Gọi API bằng phiên của một vai trò, để tạo dữ liệu cho test (nhanh và chắc hơn qua UI)
  apiAs: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role) => {
      const ctx = await playwright.request.newContext({ baseURL, storageState: authFile(role) });
      contexts.push(ctx);
      return ctx;
    });
    await Promise.all(contexts.map((c) => c.dispose()));
  },
  // Tên duy nhất cho mỗi test, để test chạy song song không giẫm dữ liệu của nhau
  uniqueName: async ({}, use, testInfo) => {
    let n = 0;
    await use((prefix) => `${prefix} ${testInfo.workerIndex}-${Date.now()}-${n++}`);
  },
  // Một trình duyệt riêng (context riêng, cookie riêng) cho mỗi vai trò trong cùng một test
  pageAs: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
    await use(async (role) => {
      const ctx = await browser.newContext({ storageState: authFile(role) });
      contexts.push(ctx);
      return ctx.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect };
```

- Test tự tạo dữ liệu nó cần qua API (`apiAs`), tên duy nhất (`uniqueName`): không phụ thuộc test khác hay thứ tự chạy, chạy song song an toàn.
- Môi trường test dùng chung lâu dài (staging) thì dọn dữ liệu test định kỳ, hoặc xoá trong phần sau `await use(...)` của fixture.

## 5. Viết test bền

```ts
// tests/e2e/customers.spec.ts
import { test, expect, TENANT_A, TENANT_B } from './fixtures';

test('tạo khách mới và thấy trong danh sách @mobile', async ({ page, uniqueName }) => {
  const name = uniqueName('Khách E2E');
  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByRole('button', { name: 'Thêm khách' }).click();
  await page.getByLabel('Họ tên').fill(name);
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('bỏ trống họ tên thì báo lỗi ngay tại field', async ({ page }) => {
  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByRole('button', { name: 'Thêm khách' }).click();
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByLabel('Họ tên')).toHaveAccessibleDescription('Vui lòng nhập họ tên');
});
```

- Tìm phần tử như người dùng thấy: `getByRole` > `getByLabel` > `getByText` > `getByTestId`. Không dùng CSS class hay XPath. Không tìm được bằng role/label thường là dấu hiệu UI thiếu nhãn cho trình đọc màn hình: sửa UI.
- Assertion tự chờ (`await expect(...).toBeVisible()`). Không `waitForTimeout`, không chờ `networkidle`.
- `toHaveAccessibleDescription` kiểm cùng lúc thông báo lỗi hiện ra **và** được gắn với đúng field (`aria-describedby`).
- Locator cho phần tử phổ biến (`alert`, `button` "Lưu") có thể khớp nhiều chỗ: khoanh vùng (`page.getByRole('main').getByRole('alert')`). Next.js luôn có sẵn một phần tử `role="alert"` (route announcer), nên `page.getByRole('alert')` trần sẽ lỗi strict mode.
- Page Object chỉ khi cùng một chuỗi thao tác lặp ở nhiều file; trước đó, fixture và hàm nhỏ là đủ.

## 6. Luồng nhiều vai trò

Mỗi vai trò một browser context riêng (cookie riêng), trong cùng một test:

```ts
// tests/e2e/appointments.spec.ts
import { test, expect, TENANT_A, hoursFromNow } from './fixtures';

test('lễ tân tạo lịch, chủ spa xác nhận, lễ tân thấy trạng thái mới', async ({ pageAs, apiAs, uniqueName }) => {
  const customerName = uniqueName('Khách lịch');
  const asStaff = await apiAs('staff-a');
  const created = await asStaff.post(`/t/${TENANT_A}/api/appointments`, {
    data: { customerName, startsAt: hoursFromNow(48) },
  });
  expect(created.status()).toBe(201);

  const owner = await pageAs('owner-a');
  const staff = await pageAs('staff-a');

  await owner.goto(`/t/${TENANT_A}/appointments`);
  await owner.getByRole('button', { name: `Xác nhận lịch của ${customerName}` }).click();
  await expect(owner.getByRole('row', { name: customerName })).toContainText('confirmed');

  await staff.goto(`/t/${TENANT_A}/appointments`);
  await expect(staff.getByRole('row', { name: customerName })).toContainText('confirmed');
  // lễ tân không có quyền xác nhận: không thấy nút, và API cũng chặn
  await expect(staff.getByRole('button', { name: /^Xác nhận/ })).toHaveCount(0);
  const { id } = await created.json();
  expect((await asStaff.post(`/t/${TENANT_A}/api/appointments/${id}/confirm`)).status()).toBe(403);
});
```

Kiểm cả hai phía của phân quyền: UI không hiện nút, **và** API vẫn chặn khi gọi thẳng. Ẩn nút không phải là phân quyền.

## 7. Đổi workspace và cô lập tenant

Hai lỗi thật hay gặp (skill `frontend`, `state-management.md` mục 3 và 5; từ file này: `../../frontend/references/state-management.md`): response của workspace cũ về muộn và đè lên màn hình mới; và trong lúc workspace mới đang tải, màn hình vẫn giữ danh sách cũ (vd `keepPreviousData` dùng không đúng). Test giữ response lại bằng `page.route` để tạo đúng thời điểm đó:

```ts
// tests/e2e/workspace-switch.spec.ts
import type { Request } from '@playwright/test';
import { test, expect, TENANT_A, TENANT_B } from './fixtures';

test('đổi workspace: không hiện dữ liệu của workspace cũ, kể cả khi response cũ về muộn', async ({ pageAs }) => {
  const page = await pageAs('multi');
  // Giữ response danh sách của A lại cho tới khi đã sang B
  let releaseA!: () => void;
  const held = new Promise<void>((resolve) => (releaseA = resolve));
  await page.route(`**/t/${TENANT_A}/api/customers`, async (route) => {
    await held;
    await route.continue().catch(() => {});   // app đã huỷ request thì không còn gì để tiếp
  });
  // Request cũ của A kết thúc theo một trong hai cách: có response, hoặc bị app huỷ khi đổi workspace
  const settledA = new Promise<void>((resolve) => {
    const done = (req: Request) => { if (req.url().includes(`/t/${TENANT_A}/api/customers`)) resolve(); };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });

  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByLabel('Workspace').selectOption({ label: 'Spa Bạch Dương' });
  await expect(page.getByRole('link', { name: 'Trần Văn B1' })).toBeVisible();

  releaseA();                                  // response của A giờ mới về (nếu chưa bị huỷ)
  await settledA;
  await expect(page.getByRole('link', { name: 'Trần Văn B1' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nguyễn Thị A1' })).toHaveCount(0);
});

test('đổi workspace: lúc workspace mới đang tải không hiện dữ liệu của workspace cũ', async ({ pageAs }) => {
  const page = await pageAs('multi');
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByRole('link', { name: 'Nguyễn Thị A1' })).toBeVisible();   // A đã tải xong

  // Giữ response của B: trong lúc chờ, màn hình không được giữ danh sách của A
  let releaseB!: () => void;
  const held = new Promise<void>((resolve) => (releaseB = resolve));
  await page.route(`**/t/${TENANT_B}/api/customers`, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByLabel('Workspace').selectOption({ label: 'Spa Bạch Dương' });
  await expect(page.getByRole('link', { name: 'Nguyễn Thị A1' })).toHaveCount(0);

  releaseB();
  await expect(page.getByRole('link', { name: 'Trần Văn B1' })).toBeVisible();
});
```

- Test thứ nhất chờ request cũ **kết thúc** (`requestfinished` hoặc `requestfailed`) chứ không chờ response: app đúng sẽ huỷ request đó khi đổi workspace, và chờ response sẽ treo mãi.
- Kiểm chứng: bản app bỏ phần chặn response muộn làm test thứ nhất fail 5/5 lần (workspace "Spa Bạch Dương" hiện khách của Spa Hoa Mai); bản app giữ danh sách cũ lúc đang tải làm test thứ hai fail 5/5 lần.

Mở tài nguyên của tenant khác bằng URL:

```ts
import { test, expect, TENANT_A, TENANT_B } from './fixtures';

test('không mở được khách của tenant khác bằng URL', async ({ page, apiAs, uniqueName }) => {
  const asB = await apiAs('owner-b');
  const res = await asB.post(`/t/${TENANT_B}/api/customers`, { data: { name: uniqueName('Khách của B') } });
  expect(res.status()).toBe(201);
  const { id } = await res.json();

  await page.goto(`/t/${TENANT_B}/customers/${id}`);  // workspace mình không phải thành viên
  await expect(page.getByRole('heading', { name: 'Không tìm thấy' })).toBeVisible();
  await page.goto(`/t/${TENANT_A}/customers/${id}`);  // id của B gắn vào URL của A
  await expect(page.getByRole('heading', { name: 'Không tìm thấy' })).toBeVisible();
});
```

Test này bổ sung, không thay test cô lập ở tầng API (skill `backend`; từ file này: `../../backend/references/isolation-tests.md`).

## 8. Thời gian: giờ server và giờ trình duyệt

Hai loại giờ khác nhau, test khác nhau:

- **Quy tắc tính theo giờ server** (huỷ trước 24 giờ, hết hạn, nhắc lịch): `page.clock` không đổi được giờ server. Tạo dữ liệu tương đối với lúc chạy test, tránh sát mốc; các trường hợp biên thì test ở unit test với `now` truyền vào (skill `architecture`; từ file này: `../../architecture/references/ddd.md` mục 4).

```ts
import { test, expect, TENANT_A, hoursFromNow } from './fixtures';

// BR-07: huỷ lịch đã xác nhận trước 24 giờ thì hoàn cọc. Giờ ở đây là giờ của SERVER,
// nên dữ liệu đặt tương đối với thời điểm chạy test, tránh sát mốc 24 giờ.
for (const { hours, expected } of [
  { hours: 25, expected: 'Hoàn cọc 200000' },
  { hours: 2, expected: 'Không hoàn cọc' },
]) {
  test(`huỷ lịch đã xác nhận còn ${hours} giờ: ${expected}`, async ({ page, apiAs, uniqueName }) => {
    const customerName = uniqueName('Khách huỷ');
    const asOwner = await apiAs('owner-a');
    const res = await asOwner.post(`/t/${TENANT_A}/api/appointments`, {
      data: { customerName, startsAt: hoursFromNow(hours) },
    });
    const { id } = await res.json();
    await asOwner.post(`/t/${TENANT_A}/api/appointments/${id}/confirm`);

    await page.goto(`/t/${TENANT_A}/appointments`);
    await page.getByRole('button', { name: `Huỷ lịch của ${customerName}` }).click();
    await expect(page.getByRole('row', { name: customerName })).toContainText(expected);
  });
}
```

- **Hiển thị theo giờ trình duyệt** (lời chào, "3 phút trước", đếm ngược): dùng `page.clock`.

```ts
// tests/e2e/clock.spec.ts
import { test, expect, TENANT_A } from './fixtures';

// page.clock chỉ đổi giờ của TRÌNH DUYỆT (Date, setTimeout trong trang), không đổi giờ server
test('lời chào theo giờ của trình duyệt', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T08:00:00+07:00'));
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByTestId('greeting')).toHaveText('Chào buổi sáng');

  await page.clock.setFixedTime(new Date('2026-10-25T20:00:00+07:00'));
  await page.reload();
  await expect(page.getByTestId('greeting')).toHaveText('Chào buổi tối');
});
```

## 9. Mock mạng: trạng thái lỗi, response chậm, dịch vụ ngoài

```ts
import { test, expect, TENANT_A } from './fixtures';

test('API lỗi thì hiện thông báo và thử lại được', async ({ page }) => {
  // Tìm alert trong <main>: framework có thể có sẵn phần tử role="alert" khác (vd route announcer của Next.js)
  const alert = page.getByRole('main').getByRole('alert');
  let fail = true;
  await page.route(`**/t/${TENANT_A}/api/customers`, (route) =>
    fail ? route.fulfill({ status: 500, json: { code: 'internal' } }) : route.continue());
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(alert).toHaveText('Không tải được danh sách.');
  fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('button', { name: 'Thêm khách' })).toBeVisible();
  await expect(alert).toHaveCount(0);
});
```

- Dùng `page.route` cho: trạng thái lỗi khó tạo thật (500, mất mạng: `route.abort()`), response chậm (mục 7), dữ liệu cố định cho so ảnh (mục 10), dịch vụ bên ngoài (bản đồ, analytics).
- **Không mock API của chính mình trong test luồng chính**: khi đó test không còn là E2E, lỗi ghép nối FE và BE lọt qua.
- Thanh toán: dùng sandbox của cổng trên môi trường test. Cổng kiểu chuyển hướng hoặc QR (VNPay, MoMo...): test tới bước chuyển hướng (URL và số tiền đúng), còn kết quả thì gửi callback/IPN giả lập có chữ ký sandbox vào API, rồi kiểm UI cập nhật trạng thái.

## 10. So ảnh giao diện

```ts
// tests/e2e/visual.spec.ts
import { test, expect, TENANT_A } from './fixtures';

test('màn danh sách khách khớp ảnh chuẩn', async ({ page }) => {
  // Ảnh chuẩn cần dữ liệu cố định: test khác chạy song song đang thêm khách vào cùng tenant
  await page.route(`**/t/${TENANT_A}/api/customers`, (route) =>
    route.fulfill({ json: { data: [
      { id: 'c1', name: 'Nguyễn Thị Lan' },
      { id: 'c2', name: 'Trần Văn Minh' },
    ] } }));
  await page.clock.setFixedTime(new Date('2026-10-25T08:00:00+07:00'));
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByRole('link', { name: 'Trần Văn Minh' })).toBeVisible();
  await expect(page).toHaveScreenshot('customers.png', {
    mask: [page.getByTestId('greeting')],   // phần còn thay đổi (giờ, avatar, số liệu thật) thì che
  });
});
```

- Lần đầu và mỗi khi đổi giao diện có chủ đích: `pnpm exec playwright test --update-snapshots`, xem ảnh mới trước khi commit.
- Ảnh phụ thuộc hệ điều hành và font (tên file có hậu tố như `-chromium-linux.png`): tạo và so ảnh trong **cùng một môi trường**, là image Docker chính thức cùng version với `@playwright/test`. CI ở mục 13 chạy trong image đó; tạo lại ảnh chuẩn trên máy thì chạy cùng image, trỏ vào app đang chạy trên máy (app phải nghe trên `0.0.0.0`, không chỉ `localhost`):
  ```bash
  docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway \
    -e E2E_BASE_URL=http://host.docker.internal:3000 -e E2E_PASSWORD \
    -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
    npx playwright test tests/e2e/visual.spec.ts --update-snapshots
  ```
  Project `setup` vẫn chạy trước (đăng nhập), nên cần `E2E_PASSWORD` và DB có dữ liệu seed như lúc chạy bình thường.
- Dữ liệu cố định (mock bằng `page.route`), giờ cố định, che phần còn thay đổi. Chỉ che (`mask`) là không đủ khi dữ liệu làm đổi bố cục: bản đầu của test trên che bảng khách, và vẫn fail khi chạy song song vì test khác thêm khách làm bảng dài ra.
- Chỉ vài màn quan trọng; animation mặc định được tắt khi chụp.

## 11. Truy cập được (a11y)

```ts
// tests/e2e/a11y.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { test, expect, TENANT_A } from './fixtures';

test('màn khách hàng không có lỗi a11y mức WCAG A/AA', async ({ page }) => {
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByRole('button', { name: 'Thêm khách' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('thêm khách chỉ bằng bàn phím', async ({ page, uniqueName }) => {
  const name = uniqueName('Khách bàn phím');
  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByRole('button', { name: 'Thêm khách' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Họ tên')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name })).toBeVisible();
});
```

axe chỉ bắt được một phần lỗi a11y (thiếu nhãn, tương phản, ARIA sai). Thứ tự focus, thao tác bằng bàn phím, thông báo cho trình đọc màn hình vẫn cần test như ví dụ thứ hai và kiểm tay.

## 12. Debug khi test fail

Trên máy có giao diện:

```bash
pnpm exec playwright test --ui                         # chạy, xem từng bước, time travel
pnpm exec playwright test customers.spec.ts --debug    # dừng từng bước với Inspector
pnpm exec playwright codegen http://localhost:3000     # thao tác tay để lấy locator, rồi viết lại cho gọn
pnpm exec playwright show-report
pnpm exec playwright show-trace test-results/<test>/trace.zip
```

Claude (không có giao diện) debug như sau:

1. Chạy đúng file fail: `pnpm exec playwright test tests/e2e/customers.spec.ts --reporter=line`.
2. Đọc `test-results/<tên test>/error-context.md` (lỗi, call log, ảnh chụp cây ARIA của trang lúc fail) và mở `test-failed-1.png`.
3. Sửa nguyên nhân gốc (thường là: chờ sai thứ, dữ liệu dùng chung, locator mơ hồ, hoặc bug thật của app). Không tăng timeout hay thêm `waitForTimeout` để "cho qua".
4. Chạy lại `--last-failed`, rồi `--repeat-each=5 --workers=4` để chắc không chập chờn.

## 13. Chạy trong CI

Workflow riêng, chạy trong image Playwright chính thức (cùng môi trường với ảnh chuẩn ở mục 10), chia shard và gộp report (đã qua actionlint). `db/ci-roles.sql` và cách tạo role: skill `ship`, `ci-cd.md` mục 3 (từ file này: `../../ship/references/ci-cd.md`).

```yaml
# .github/workflows/e2e.yml
name: e2e
on:
  pull_request:
  workflow_dispatch:

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    # Cùng image với lúc tạo ảnh chuẩn (mục 10), cùng version với @playwright/test; trình duyệt có sẵn
    container: mcr.microsoft.com/playwright:v1.63.0-noble
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    services:
      postgres:
        image: postgres:16               # cùng major version với production
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app_e2e
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      # job chạy trong container: service gọi bằng tên "postgres", không phải localhost
      ADMIN_DATABASE_URL: postgres://postgres:postgres@postgres:5432/app_e2e
      MIGRATION_DATABASE_URL: postgres://app_owner:app_owner@postgres:5432/app_e2e
      DATABASE_URL: postgres://app_user:app_user@postgres:5432/app_e2e
      E2E_PASSWORD: e2e-only-password    # DB tạm của CI, tài khoản do seed tạo, không phải bí mật
    steps:
      - uses: actions/checkout@v4
      - run: apt-get update && apt-get install -y --no-install-recommends postgresql-client
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/ci-roles.sql
      - run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ env.MIGRATION_DATABASE_URL }}
      - run: pnpm db:seed:e2e            # tenant A/B và tài khoản theo vai trò
      - run: pnpm exec playwright test --shard=${{ matrix.shard }}/2 --reporter=blob
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: blob-report-${{ matrix.shard }}
          path: blob-report
          retention-days: 7

  report:
    if: ${{ !cancelled() }}
    needs: e2e
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with:
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true
      - run: pnpm exec playwright merge-reports --reporter html ./all-blob-reports
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 14
```

- `retries: 2` ở CI chỉ để không chặn merge vì một lần chập chờn; report vẫn đánh dấu test `flaky`, coi đó là bug cần task card. Muốn chặt hơn trên `main`: thêm `--fail-on-flaky-tests`.
- Chạy vào staging hoặc preview: đặt `E2E_BASE_URL`, bỏ bước dựng DB, tài khoản và mật khẩu test lấy từ secret của Environment.
- Report và trace là artifact: tải về rồi `pnpm exec playwright show-report <thư mục>`.

## 14. Cho Claude điều khiển trình duyệt

Ngoài bộ test, Claude có thể mở trình duyệt để khám phá trang, tái hiện bug, tìm tên truy cập được của phần tử trước khi viết locator:

- **Playwright CLI** (tiết kiệm token, hợp với agent viết code): `npm install -g @playwright/cli@latest`, rồi `playwright-cli install --skills`. Lệnh chính: `playwright-cli open <url>`, `snapshot`, `click <ref>`, `type <text>`, `screenshot`.
- **Playwright MCP** (khi cần giữ trạng thái trình duyệt qua phiên dài, khám phá nhiều bước): `claude mcp add playwright npx @playwright/mcp@latest`.

Kiểm cách cài theo README hiện hành của hai dự án này trước khi dùng (công cụ còn mới, lệnh có thể đổi). Những gì phát hiện được khi duyệt tay phải trở thành file test trong repo chạy được ở CI; duyệt tay không phải là test. Chỉ cho agent vào môi trường test, không vào production bằng tài khoản thật.

## 15. Trước khi coi là xong

- Test **fail khi tính năng hỏng**: thử làm hỏng code (hoặc chạy trên commit trước khi sửa bug) và thấy test đỏ, như cách test đổi workspace được kiểm ở mục 7.
- Pass với `--repeat-each=5 --workers=4`.
- Không `waitForTimeout`; dữ liệu riêng cho từng test; không phụ thuộc thứ tự.
- Locator theo role và label; lỗi hiển thị được kiểm gắn đúng field.
- Có trong CI, giữ report và trace khi fail; luồng mới được ghi vào `docs/TESTING.md`.
