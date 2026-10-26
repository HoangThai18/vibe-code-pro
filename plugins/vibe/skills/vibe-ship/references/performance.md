# Performance: measure, find the bottleneck, load test

Every number and code sample here ran for real: k6 1.8.2 against a Node API + PostgreSQL 16 with 500,000 customers across 50 tenants; Playwright 1.64 and `web-vitals` 6 on Chromium. The workflow passes actionlint.

## Contents
1. Set targets first
2. Measure before fixing
3. Slow queries in Postgres
4. Load testing with k6
5. Web page performance
6. When to scale infrastructure

## 1. Set targets first

"Fast" must be a number, written in the PRD or ARCHITECTURE (the `vibe-plan` skill):

- **API**: p95 latency per endpoint group (e.g. lists under 300 ms, creating an appointment under 500 ms), error rate under 1%, at the target load (e.g. 3x the current peak, or the tenant count expected in 12 months).
- **Web**: Core Web Vitals "good" at the 75th percentile of real page loads: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
- **Background jobs**: maximum wait in the queue (e.g. appointment reminders sent within 10 minutes).

## 2. Measure before fixing

Guesses about what's slow are usually wrong. Look in this order:

1. **Which endpoint is slow**: traces and per-route metrics (`references/observability.md`), or k6 results split by `name` (section 4).
2. **Where the endpoint's time goes**: DB spans, external API spans; the rest is app CPU.
3. **DB**: `pg_stat_statements` and `EXPLAIN (ANALYZE, BUFFERS)` (section 3).
4. **App CPU**: run `node --cpu-prof` under load and open the `.cpuprofile` file in Chrome DevTools to see which functions take the time.
5. **Browser**: Lighthouse, the DevTools Performance tab, and real-user measurements (section 5).

Fix one thing, re-measure with the same scenario, put the before/after numbers in the PR.

## 3. Slow queries in Postgres

Enable `pg_stat_statements` (add it to `shared_preload_libraries`, restart Postgres, `CREATE EXTENSION pg_stat_statements`; managed DBs usually have an option for it). See which statements take the most total time:

```sql
-- top 10 statements by total time since the last reset
SELECT round(total_exec_time)              AS total_ms,
       calls,
       round(mean_exec_time::numeric, 1)   AS mean_ms,
       round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct,
       left(regexp_replace(query, '\s+', ' ', 'g'), 80) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC
 LIMIT 10;
```

Real result on the sample API before the index:

```text
 total_ms | calls | mean_ms |  pct  | query
----------+-------+---------+-------+---------------------------------------------------------
    11975 |   524 |    22.9 | 100.0 | SELECT id, name, phone, created_at FROM customers WHERE tenant_id = $1 ORDER BY ...
```

`EXPLAIN (ANALYZE, BUFFERS)` on that query shows a full table scan (`Parallel Seq Scan`, 6,149 buffers, 24 ms) followed by a sort. Add an index matching how the query filters and sorts (equality columns first, sort column last):

```sql
CREATE INDEX CONCURRENTLY customers_tenant_created ON customers (tenant_id, created_at DESC);
```

Afterwards: `Index Scan using customers_tenant_created`, 12 buffers, 0.06 ms. Same load test as in section 4 (ramp to 150 requests/second over 15 seconds, then hold 30 seconds):

| | Before | After |
|---|---|---|
| p95 | 2.74 s | 1.97 ms |
| Average requests/second over the run | 76 (k6 dropped 2,068 iterations because the server couldn't keep up) | 126, exactly the configured rate (nothing dropped) |
| Threshold `p(95)<300` | Failed, k6 exit code 99 | Passed |

Other common causes: N+1 queries through the ORM (the `vibe-backend` skill, `references/orm.md`), `OFFSET` pagination on large tables, a full-table `count(*)` for every page, missing indexes on FK columns, transactions held open across external API calls, a connection pool too small (requests queue up) or too large (DB overloaded). Always create indexes on live tables with `CONCURRENTLY`, in a separate migration (`references/release-rollback.md`).

## 4. Load testing with k6

```js
// load/customers-list.js — run: k6 run -e BASE_URL=https://staging.example.vn load/customers-list.js
import http from 'k6/http';
import { check } from 'k6';

// One login token per tenant, for staging test accounts (created by the seed script, never real accounts)
const TENANTS = JSON.parse(open('./tenants.json'));
const BASE_URL = __ENV.BASE_URL;

export const options = {
  scenarios: {
    list_customers: {
      executor: 'ramping-arrival-rate',   // keeps the request rate even when the server slows down
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: Number(__ENV.RPS || 100), duration: __ENV.RAMP || '30s' },   // ramp up to the target rate
        { target: Number(__ENV.RPS || 100), duration: __ENV.HOLD || '1m' },    // hold it
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                               // under 1% errors
    'http_req_duration{name:customers_list}': ['p(95)<300'],      // p95 under 300 ms
  },
};

export default function () {
  const tenant = TENANTS[Math.floor(Math.random() * TENANTS.length)];   // spread across tenants like real traffic
  const res = http.get(`${BASE_URL}/v1/t/${tenant.id}/customers?limit=20`, {
    headers: { authorization: `Bearer ${tenant.token}` },
    tags: { name: 'customers_list' },                                    // group URLs of different tenants into one metric series
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

```bash
k6 run -e BASE_URL=https://staging.example.vn load/customers-list.js        # target load
k6 run -e BASE_URL=... -e RPS=5 -e RAMP=10s -e HOLD=1m load/customers-list.js   # smoke test after each staging deploy
```

Reading the results:

- k6 exits non-zero when any entry in `thresholds` fails: use the exit code to turn CI red.
- `dropped_iterations` above 0 means the configured request rate wasn't reached (a slow server used up all VUs); that is also a sign of overload, even when p95 looks fine.
- Watch CPU, DB connections and memory of the app and the DB during the run: whatever hits its ceiling first is the bottleneck.

Test types:

| Test | Load | Duration | When |
|---|---|---|---|
| Smoke | A few requests/second | 1 minute | After each staging deploy |
| Target load | The level from section 1 | 15 to 30 minutes | Before major releases, after DB or infrastructure changes |
| Breakpoint | Ramp up until it breaks | Until errors or p95 exceeds the threshold | Capacity planning |
| Soak | Normal load | Several hours | Suspected memory or connection leaks |

Rules:

- Run on **staging with production-like data volume** (a seed script creates enough tenants, customers, appointments). On small tables every query is fast.
- Never run against production without a plan and advance notice; never fire load at third-party APIs (payment gateways, SMS): use sandboxes or simulators on staging.
- Spread requests across many tenants and accounts like real traffic, including login; dedicated test accounts, never real ones.
- Record results (p95, requests/second, errors, machine config) in `docs/releases/` to compare runs.

Run on a schedule or manually in GitHub Actions:

```yaml
# .github/workflows/load-test.yml — manual or nightly on staging, not on every PR
name: Load test
on:
  workflow_dispatch:
    inputs:
      rps:
        description: Số request mỗi giây ở mức giữ
        default: "100"
  schedule:
    - cron: "30 19 * * *"   # 02:30 Vietnam time, when staging is quiet
permissions:
  contents: read
jobs:
  k6:
    runs-on: ubuntu-latest
    environment: staging                       # test tokens come from this environment's secrets
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - name: Tạo file token test từ secret
        run: printf '%s' "$LOAD_TEST_TENANTS" > load/tenants.json
        env:
          LOAD_TEST_TENANTS: ${{ secrets.LOAD_TEST_TENANTS }}
      - name: Chạy k6 (fail nếu vượt ngưỡng trong options.thresholds)
        run: >
          docker run --rm -v "$PWD/load:/load" -w /load grafana/k6:1.8.2 run
          -e BASE_URL="$BASE_URL" -e RPS="$RPS" --summary-export /load/summary.json customers-list.js
        env:
          BASE_URL: ${{ vars.STAGING_URL }}
          RPS: ${{ inputs.rps || '100' }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: k6-summary
          path: load/summary.json
```

## 5. Web page performance

Two data sources; use both:

- **Lab** (CI): measured on the CI machine with throttled CPU and network, to catch regressions before merge. Can't measure INP (needs real interaction).
- **Real users**: the `web-vitals` library sends measurements to the server; these are the numbers to compare with the targets in section 1.

A budget in CI with Playwright (add it to the E2E suite: the `vibe-build` skill, `references/e2e-playwright.md`):

```ts
// tests/perf/customers.perf.spec.ts — performance budget run in CI (lab numbers, to catch regressions)
import { expect, test } from '@playwright/test';

test('customer list page: LCP and CLS within budget', async ({ page }) => {
  // Emulate a slow device and slow 4G so a fast CI machine doesn't hide problems
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });

  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  const { lcp, cls } = await page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number }>((resolve) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve({ lcp, cls }), 500);   // wait for buffered entries to be delivered
      }),
  );

  expect(lcp, 'LCP (ms)').toBeLessThan(2500);
  expect(cls, 'CLS').toBeLessThan(0.1);
});
```

Tried on a page with a banner inserted after load: measured CLS 0.23 and the test failed as expected.

Real-user measurements:

```ts
// apps/web/src/report-web-vitals.ts — call once at app startup
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

// Measurements from users' real browsers: the most accurate source for INP (needs real interaction)
function send(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,        // LCP | INP | CLS
    value: metric.value,
    rating: metric.rating,    // good | needs-improvement | poor
    id: metric.id,
    page: location.pathname,  // path only, no query string (may contain personal data)
  });
  // sendBeacon still delivers when the user closes the tab
  if (!navigator.sendBeacon?.('/v1/vitals', body)) {
    void fetch('/v1/vitals', { method: 'POST', body, keepalive: true });
  }
}

export function reportWebVitals() {
  onLCP(send);
  onINP(send);
  onCLS(send);
}
```

The server stores these (or forwards them to an analytics tool) and reports the 75th percentile per page. Common fixes:

- **LCP**: right-sized main image in a modern format, no lazy-loading above the fold; render the first data on the server; reduce render-blocking JavaScript.
- **CLS**: reserve height for images, banners, ad slots and loading placeholders; never insert content above content already shown.
- **INP**: split heavy main-thread work, don't re-render a whole long list on every keystroke (the `vibe-frontend` skill, `references/state-management.md`), virtualize very long lists.
- Bundle size budget: compare build file sizes between PRs; split code by route.

## 6. When to scale infrastructure

In order; move on only when measurements show the previous step isn't enough:

1. Fix queries, add indexes, remove N+1 (section 3).
2. Cache: HTTP headers for public data; in-app cache for read-heavy data, keys always include `tenant_id`, with invalidation when data changes.
3. Move slow work to background jobs (the `vibe-backend` skill, `references/jobs.md`).
4. A bigger machine (more CPU and RAM for the DB is usually cheaper than architecture work).
5. More app instances (the app keeps no in-memory state), a DB connection pooler (PgBouncer).
6. Read replicas for reports and heavy read queries.
7. Split services, partition data: only with measurements and a clear reason, recorded in an ADR (the `vibe-architecture` skill).
