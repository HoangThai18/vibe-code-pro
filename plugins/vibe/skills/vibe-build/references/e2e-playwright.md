# UI and user-flow tests with Playwright

Unit and integration tests can't see what users see: a button that doesn't respond, a screen showing the old workspace's data, a form unusable by keyboard, staff seeing a button only the spa owner may press. Playwright runs real browsers (Chromium, Firefox, WebKit), auto-waits for elements to be ready, and records traces to replay each step on failure.

Every code sample here ran with `@playwright/test` 1.63 on Chromium, repeated 5 times with 4 parallel workers without flakiness, against both an app that cancels requests on navigation and one with a built-in `role="alert"` element as in Next.js. The two workspace-switch tests (section 7) were run against deliberately broken app versions and failed every time: they catch real bugs, they don't just pass.

## Contents
1. Which flows to test
2. Install and config
3. Log in once per role
4. Fixtures: data and browsers per role
5. Writing robust tests
6. Multi-role flows
7. Workspace switching and tenant isolation
8. Time: server clock vs browser clock
9. Network mocks: error states, slow responses, external services
10. Visual comparison
11. Accessibility (a11y)
12. Debugging failures
13. Running in CI
14. Letting the agent drive a browser
15. Before calling it done

## 1. Which flows to test

E2E is slow and costly to maintain, so keep it for flows whose failure loses money or customers: login, the main value-creating flow (booking, ordering), payment, role-based permissions, workspace switching, tenant isolation. Each phase adds E2E for its own flows.

| To check | Cheapest way |
|---|---|
| Calculations, business rules, state machines | Unit test (`references/testing.md`) |
| Queries, RLS, endpoints, error format | Integration with a real DB |
| Components with logic (forms, filter tables) | Component test + MSW |
| Flows across FE and BE, several screens, several roles | **Playwright E2E** (this file) |
| UI drifting from the baseline | `toHaveScreenshot` for a few key screens (section 10) |
| Accessibility | axe + keyboard tests (section 11) |

## 2. Install and config

```bash
pnpm create playwright                      # or: npm init playwright@latest
pnpm exec playwright install --with-deps chromium
pnpm add -D @axe-core/playwright            # if testing a11y (section 11)
```

Known trap: `@axe-core/playwright` declares `playwright-core` as a peer dependency, the package manager may install a newer `playwright-core` than the one `@playwright/test` uses, and TypeScript reports `Type 'Page' is missing the following properties from type 'Page'`. Fix: add `playwright-core` at the **same version** as `@playwright/test` to devDependencies.

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,          // a forgotten test.only fails CI
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',      // fixed browser time zone, independent of the test machine
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
      grep: /@mobile/,                     // only tests tagged @mobile
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? 'pnpm build && pnpm start' : 'pnpm dev',
        url: `http://localhost:${PORT}/health/ready`,   // readiness endpoint (ship skill, observability.md)
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

- Fixed `timezoneId` and `locale` keep tests independent of the machine.
- The `mobile` project runs only tests tagged `@mobile` (in the test title), not the whole suite twice.
- When `E2E_BASE_URL` is set (staging, preview), no server is started.

## 3. Log in once per role

Log in via the API and save the cookies; faster than filling the form in every test:

```ts
// tests/e2e/auth.setup.ts
// Log in via the API once per role and save cookies for the tests to reuse.
// Faster than the form; the form login flow has its own test (login.spec.ts).
import { test as setup, expect } from '@playwright/test';
import { ROLES, authFile } from './fixtures';

for (const [role, email] of Object.entries(ROLES)) {
  setup(`sign in as ${role}`, async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { email, password: process.env.E2E_PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    await request.storageState({ path: authFile(role) });
  });
}
```

The form login flow still needs its own test:

```ts
// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } }); // logged out

test('logs in via the form and lands on the customer list @mobile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner-a@example.test');
  await page.getByLabel('Mật khẩu').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
});

test('wrong password shows an error and stays on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner-a@example.test');
  await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Sai email hoặc mật khẩu');
  await expect(page).toHaveURL(/\/login$/);
});
```

- Files in `.auth/` hold session cookies: never commit them; use only test accounts on test environments. Never run E2E with real accounts on production.
- App logs in via a third party (Google, Zalo): on the test environment add a login endpoint enabled only by a config flag, or use the provider's test accounts; never automate the provider's login form.

## 4. Fixtures: data and browsers per role

```ts
// tests/e2e/fixtures.ts
import { test as base, expect, type APIRequestContext, type Browser } from '@playwright/test';

export const TENANT_A = 'spa-a';
export const TENANT_B = 'spa-b';

// Accounts seeded on the test environment; password from the E2E_PASSWORD env var
export const ROLES = {
  'owner-a': 'owner-a@example.test',
  'staff-a': 'staff-a@example.test',
  'owner-b': 'owner-b@example.test',
  multi: 'multi@example.test',          // member of both tenants
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
  // Call the API with a role's session to create test data (faster and more reliable than the UI)
  apiAs: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role) => {
      const ctx = await playwright.request.newContext({ baseURL, storageState: authFile(role) });
      contexts.push(ctx);
      return ctx;
    });
    await Promise.all(contexts.map((c) => c.dispose()));
  },
  // Unique name per test, so parallel tests don't step on each other's data
  uniqueName: async ({}, use, testInfo) => {
    let n = 0;
    await use((prefix) => `${prefix} ${testInfo.workerIndex}-${Date.now()}-${n++}`);
  },
  // A separate browser (own context, own cookies) per role within one test
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

- Each test creates its data via the API (`apiAs`) with unique names (`uniqueName`): no dependence on other tests or run order, safe in parallel.
- On a long-lived shared test environment (staging), clean up test data periodically, or delete it after `await use(...)` in the fixture.

## 5. Writing robust tests

```ts
// tests/e2e/customers.spec.ts
import { test, expect, TENANT_A, TENANT_B } from './fixtures';

test('creates a customer and sees it in the list @mobile', async ({ page, uniqueName }) => {
  const name = uniqueName('Khách E2E');
  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByRole('button', { name: 'Thêm khách' }).click();
  await page.getByLabel('Họ tên').fill(name);
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('empty name shows an error on the field', async ({ page }) => {
  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByRole('button', { name: 'Thêm khách' }).click();
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByLabel('Họ tên')).toHaveAccessibleDescription('Vui lòng nhập họ tên');
});
```

- Find elements the way users see them: `getByRole` > `getByLabel` > `getByText` > `getByTestId`. No CSS classes or XPath. If role or label can't find it, the UI usually lacks a label for screen readers: fix the UI.
- Use auto-waiting assertions (`await expect(...).toBeVisible()`). No `waitForTimeout`, no waiting for `networkidle`.
- `toHaveAccessibleDescription` checks that the error message appears **and** is attached to the right field (`aria-describedby`).
- Locators for common elements (`alert`, the "Lưu" button) can match several places: scope them (`page.getByRole('main').getByRole('alert')`). Next.js always has a `role="alert"` element (route announcer), so a bare `page.getByRole('alert')` fails strict mode.
- Page Objects only when the same action sequence repeats across files; until then, fixtures and small functions are enough.

## 6. Multi-role flows

One browser context (own cookies) per role, in the same test:

```ts
// tests/e2e/appointments.spec.ts
import { test, expect, TENANT_A, hoursFromNow } from './fixtures';

test('receptionist books, owner confirms, receptionist sees the new status', async ({ pageAs, apiAs, uniqueName }) => {
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
  // the receptionist may not confirm: no button, and the API blocks it too
  await expect(staff.getByRole('button', { name: /^Xác nhận/ })).toHaveCount(0);
  const { id } = await created.json();
  expect((await asStaff.post(`/t/${TENANT_A}/api/appointments/${id}/confirm`)).status()).toBe(403);
});
```

Check both sides of authorization: the UI hides the button **and** the API still blocks a direct call. Hiding a button is not authorization.

## 7. Workspace switching and tenant isolation

Two real, common bugs (the `vibe-frontend` skill, `references/state-management.md` sections 3 and 5): a late response from the old workspace overwrites the new screen; and while the new workspace loads, the screen keeps the old list (e.g. misused `keepPreviousData`). The tests hold responses back with `page.route` to create exactly that timing:

```ts
// tests/e2e/workspace-switch.spec.ts
import type { Request } from '@playwright/test';
import { test, expect, TENANT_A, TENANT_B } from './fixtures';

test('workspace switch: no data from the old workspace, even if its response arrives late', async ({ pageAs }) => {
  const page = await pageAs('multi');
  // Hold A's list response until we have switched to B
  let releaseA!: () => void;
  const held = new Promise<void>((resolve) => (releaseA = resolve));
  await page.route(`**/t/${TENANT_A}/api/customers`, async (route) => {
    await held;
    await route.continue().catch(() => {});   // the app cancelled the request: nothing to continue
  });
  // A's old request ends one of two ways: it gets a response, or the app cancels it on switch
  const settledA = new Promise<void>((resolve) => {
    const done = (req: Request) => { if (req.url().includes(`/t/${TENANT_A}/api/customers`)) resolve(); };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });

  await page.goto(`/t/${TENANT_A}/customers`);
  await page.getByLabel('Workspace').selectOption({ label: 'Spa Bạch Dương' });
  await expect(page.getByRole('link', { name: 'Trần Văn B1' })).toBeVisible();

  releaseA();                                  // only now does A's response arrive (if not cancelled)
  await settledA;
  await expect(page.getByRole('link', { name: 'Trần Văn B1' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nguyễn Thị A1' })).toHaveCount(0);
});

test('workspace switch: no old workspace data while the new one loads', async ({ pageAs }) => {
  const page = await pageAs('multi');
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByRole('link', { name: 'Nguyễn Thị A1' })).toBeVisible();   // A has loaded

  // Hold B's response: meanwhile the screen must not keep A's list
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

- The first test waits for the old request to **end** (`requestfinished` or `requestfailed`), not for a response: a correct app cancels that request on switch, and waiting for a response would hang forever.
- Verified: an app without the late-response guard fails the first test 5/5 times (workspace "Spa Bạch Dương" shows Spa Hoa Mai's customers); an app that keeps the old list while loading fails the second test 5/5 times.

Opening another tenant's resource by URL:

```ts
import { test, expect, TENANT_A, TENANT_B } from './fixtures';

test('cannot open a customer of another tenant by URL', async ({ page, apiAs, uniqueName }) => {
  const asB = await apiAs('owner-b');
  const res = await asB.post(`/t/${TENANT_B}/api/customers`, { data: { name: uniqueName('Khách của B') } });
  expect(res.status()).toBe(201);
  const { id } = await res.json();

  await page.goto(`/t/${TENANT_B}/customers/${id}`);  // a workspace we are not a member of
  await expect(page.getByRole('heading', { name: 'Không tìm thấy' })).toBeVisible();
  await page.goto(`/t/${TENANT_A}/customers/${id}`);  // B's id in A's URL
  await expect(page.getByRole('heading', { name: 'Không tìm thấy' })).toBeVisible();
});
```

This test adds to, not replaces, API-level isolation tests (the `vibe-backend` skill, `references/isolation-tests.md`).

## 8. Time: server clock vs browser clock

Two kinds of time, tested differently:

- **Rules computed on server time** (cancel 24 hours ahead, expiry, reminders): `page.clock` can't change server time. Create data relative to the test run time, away from the boundary; test edge cases in unit tests with an injected `now` (the `vibe-architecture` skill, `references/ddd.md` section 4).

```ts
import { test, expect, TENANT_A, hoursFromNow } from './fixtures';

// BR-07: cancelling a confirmed appointment 24+ hours ahead refunds the deposit. This is SERVER time,
// so data is set relative to the test run time, away from the 24-hour boundary.
for (const { hours, expected } of [
  { hours: 25, expected: 'Hoàn cọc 200000' },
  { hours: 2, expected: 'Không hoàn cọc' },
]) {
  test(`cancel a confirmed appointment ${hours} hours ahead: ${expected}`, async ({ page, apiAs, uniqueName }) => {
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

- **Display based on browser time** (greetings, "3 minutes ago", countdowns): use `page.clock`.

```ts
// tests/e2e/clock.spec.ts
import { test, expect, TENANT_A } from './fixtures';

// page.clock changes only BROWSER time (Date, setTimeout in the page), not server time
test('greeting follows browser time', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T08:00:00+07:00'));
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByTestId('greeting')).toHaveText('Chào buổi sáng');

  await page.clock.setFixedTime(new Date('2026-10-25T20:00:00+07:00'));
  await page.reload();
  await expect(page.getByTestId('greeting')).toHaveText('Chào buổi tối');
});
```

## 9. Network mocks: error states, slow responses, external services

```ts
import { test, expect, TENANT_A } from './fixtures';

test('API error shows a message and allows retry', async ({ page }) => {
  // Look for the alert inside <main>: the framework may have another role="alert" element (e.g. the Next.js route announcer)
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

- Use `page.route` for: error states hard to produce for real (500, offline: `route.abort()`), slow responses (section 7), fixed data for screenshots (section 10), external services (maps, analytics).
- **Never mock your own API in main-flow tests**: the test stops being E2E and FE–BE integration bugs slip through.
- Payments: use the gateway's sandbox on the test environment. Redirect or QR gateways (VNPay, MoMo...): test up to the redirect (correct URL and amount); for the result, send a simulated callback/IPN with a sandbox signature to the API, then check that the UI updates the status.

## 10. Visual comparison

```ts
// tests/e2e/visual.spec.ts
import { test, expect, TENANT_A } from './fixtures';

test('customer list screen matches the baseline', async ({ page }) => {
  // The baseline needs fixed data: parallel tests keep adding customers to the same tenant
  await page.route(`**/t/${TENANT_A}/api/customers`, (route) =>
    route.fulfill({ json: { data: [
      { id: 'c1', name: 'Nguyễn Thị Lan' },
      { id: 'c2', name: 'Trần Văn Minh' },
    ] } }));
  await page.clock.setFixedTime(new Date('2026-10-25T08:00:00+07:00'));
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByRole('link', { name: 'Trần Văn Minh' })).toBeVisible();
  await expect(page).toHaveScreenshot('customers.png', {
    mask: [page.getByTestId('greeting')],   // mask whatever still changes (time, avatars, live numbers)
  });
});
```

- First run, and after every intended UI change: `pnpm exec playwright test --update-snapshots`; review the new images before committing.
- Screenshots depend on OS and fonts (file names get a suffix like `-chromium-linux.png`): create and compare them in **the same environment**, the official Docker image at the same version as `@playwright/test`. CI in section 13 runs in that image; to regenerate baselines locally, run the same image against the app running on your machine (the app must listen on `0.0.0.0`, not just `localhost`):
  ```bash
  docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway \
    -e E2E_BASE_URL=http://host.docker.internal:3000 -e E2E_PASSWORD \
    -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
    npx playwright test tests/e2e/visual.spec.ts --update-snapshots
  ```
  The `setup` project still runs first (login), so you need `E2E_PASSWORD` and a DB with the usual seed data.
- Fixed data (mocked with `page.route`), fixed time, mask what still changes. Masking alone isn't enough when data changes the layout: the first version of the test above masked the customer table and still failed in parallel runs, because other tests added customers and the table grew.
- Only a few key screens; animations are disabled by default when capturing.

## 11. Accessibility (a11y)

```ts
// tests/e2e/a11y.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { test, expect, TENANT_A } from './fixtures';

test('customers screen has no WCAG A/AA violations', async ({ page }) => {
  await page.goto(`/t/${TENANT_A}/customers`);
  await expect(page.getByRole('button', { name: 'Thêm khách' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('adds a customer using only the keyboard', async ({ page, uniqueName }) => {
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

axe catches only some a11y issues (missing labels, contrast, wrong ARIA). Focus order, keyboard operation and screen reader announcements still need tests like the second one, plus manual checks.

## 12. Debugging failures

On a machine with a GUI:

```bash
pnpm exec playwright test --ui                         # run, inspect each step, time travel
pnpm exec playwright test customers.spec.ts --debug    # step through with the Inspector
pnpm exec playwright codegen http://localhost:3000     # record actions to get locators, then rewrite them cleanly
pnpm exec playwright show-report
pnpm exec playwright show-trace test-results/<test>/trace.zip
```

An agent (no GUI) debugs like this:

1. Run only the failing file: `pnpm exec playwright test tests/e2e/customers.spec.ts --reporter=line`.
2. Read `test-results/<test name>/error-context.md` (error, call log, ARIA snapshot of the page at failure) and open `test-failed-1.png`.
3. Fix the root cause (usually: waiting for the wrong thing, shared data, an ambiguous locator, or a real app bug). Never raise timeouts or add `waitForTimeout` to "make it pass".
4. Rerun with `--last-failed`, then `--repeat-each=5 --workers=4` to be sure it isn't flaky.

## 13. Running in CI

A separate workflow in the official Playwright image (same environment as the baselines in section 10), sharded, with merged reports (passes actionlint). `db/ci-roles.sql` and role setup: the `vibe-ship` skill (`references/ci-cd.md` section 3).

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
    # Same image as for the baselines (section 10), same version as @playwright/test; browsers preinstalled
    container: mcr.microsoft.com/playwright:v1.63.0-noble
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    services:
      postgres:
        image: postgres:16               # same major version as production
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app_e2e
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      # the job runs in a container: reach the service as "postgres", not localhost
      ADMIN_DATABASE_URL: postgres://postgres:postgres@postgres:5432/app_e2e
      MIGRATION_DATABASE_URL: postgres://app_owner:app_owner@postgres:5432/app_e2e
      DATABASE_URL: postgres://app_user:app_user@postgres:5432/app_e2e
      E2E_PASSWORD: e2e-only-password    # throwaway CI DB, account created by the seed, not a secret
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
      - run: pnpm db:seed:e2e            # tenants A/B and per-role accounts
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

- `retries: 2` in CI only keeps a one-off flake from blocking merges; the report still marks the test `flaky`; treat that as a bug that needs a task card. Stricter on `main`: add `--fail-on-flaky-tests`.
- Against staging or preview: set `E2E_BASE_URL`, drop the DB setup steps, take test accounts and passwords from the Environment's secrets.
- Reports and traces are artifacts: download, then `pnpm exec playwright show-report <folder>`.

## 14. Letting the agent drive a browser

Beyond the test suite, the agent can open a browser to explore pages, reproduce bugs, and find elements' accessible names before writing locators:

- **Playwright CLI** (token-efficient, suits coding agents): `npm install -g @playwright/cli@latest`, then `playwright-cli install --skills`. Main commands: `playwright-cli open <url>`, `snapshot`, `click <ref>`, `type <text>`, `screenshot`.
- **Playwright MCP** (keeps browser state across a long session, multi-step exploration): add the MCP server `npx @playwright/mcp@latest` to your agent's MCP config (Claude Code: `claude mcp add playwright npx @playwright/mcp@latest`).

Check the current README of both projects before installing (the tools are new; commands may change). For console, network and performance, Chrome DevTools MCP fits better; tool comparison: the `vibe-plan` skill (`references/dev-tools.md`). Whatever manual browsing finds must become a test file in the repo that runs in CI; browsing is not testing. Give the agent test environments only, never production with real accounts.

## 15. Before calling it done

- The test **fails when the feature breaks**: break the code (or run on the commit before the bug fix) and see it go red, as the workspace-switch tests were checked in section 7.
- Passes with `--repeat-each=5 --workers=4`.
- No `waitForTimeout`; per-test data; no order dependence.
- Locators by role and label; visible errors checked as attached to the right field.
- Runs in CI, keeping report and trace on failure; new flows recorded in `docs/TESTING.md`.
