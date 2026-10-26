# Hiệu năng: đo, tìm nút thắt, kiểm tải

Mọi số liệu và đoạn code trong file này đã chạy thật: k6 1.8.2 trên một API Node + PostgreSQL 16 có 500.000 khách thuộc 50 tenant; Playwright 1.64 và `web-vitals` 6 trên Chromium. Workflow đã qua actionlint.

## Mục lục
1. Đặt mục tiêu trước
2. Đo trước khi sửa
3. Query chậm trong Postgres
4. Kiểm tải bằng k6
5. Hiệu năng trang web
6. Khi nào mới cần mở rộng hạ tầng

## 1. Đặt mục tiêu trước

"Nhanh" phải là con số, ghi trong PRD hoặc ARCHITECTURE (skill `plan`):

- **API**: p95 độ trễ cho từng nhóm endpoint (vd danh sách dưới 300 ms, tạo lịch hẹn dưới 500 ms), tỉ lệ lỗi dưới 1%, ở mức tải mục tiêu (vd gấp 3 lần giờ cao điểm hiện tại, hoặc số tenant dự kiến sau 12 tháng).
- **Web**: Core Web Vitals đạt mức "tốt" ở phân vị 75 của lượt tải trang thật: LCP ≤ 2,5 giây, INP ≤ 200 ms, CLS ≤ 0,1.
- **Job nền**: thời gian chờ tối đa trong hàng đợi (vd tin nhắc lịch gửi trong vòng 10 phút).

## 2. Đo trước khi sửa

Đoán chỗ chậm thường sai. Thứ tự tìm:

1. **Endpoint nào chậm**: trace và metric theo route (`observability.md`), hoặc kết quả k6 tách theo `name` (mục 4).
2. **Trong endpoint, thời gian đi đâu**: span DB, span gọi API ngoài, phần còn lại là CPU của app.
3. **DB**: `pg_stat_statements` và `EXPLAIN (ANALYZE, BUFFERS)` (mục 3).
4. **CPU của app**: chạy `node --cpu-prof` khi đang chịu tải, mở file `.cpuprofile` trong Chrome DevTools để xem hàm nào chiếm thời gian.
5. **Trình duyệt**: Lighthouse, tab Performance của DevTools, và số đo thật từ người dùng (mục 5).

Sửa một chỗ, đo lại với cùng kịch bản, ghi số trước và sau vào PR.

## 3. Query chậm trong Postgres

Bật `pg_stat_statements` (thêm vào `shared_preload_libraries`, khởi động lại Postgres, `CREATE EXTENSION pg_stat_statements`; DB managed thường có sẵn tuỳ chọn). Xem câu nào tốn tổng thời gian nhiều nhất:

```sql
-- 10 câu tốn tổng thời gian nhiều nhất từ lần reset gần nhất
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

Kết quả thật trên API mẫu khi chưa có index:

```text
 total_ms | calls | mean_ms |  pct  | query
----------+-------+---------+-------+---------------------------------------------------------
    11975 |   524 |    22.9 | 100.0 | SELECT id, name, phone, created_at FROM customers WHERE tenant_id = $1 ORDER BY ...
```

`EXPLAIN (ANALYZE, BUFFERS)` câu đó cho thấy quét cả bảng (`Parallel Seq Scan`, 6.149 buffer, 24 ms) rồi sắp xếp. Thêm index đúng theo cách query lọc và sắp xếp (cột so bằng trước, cột sắp xếp sau):

```sql
CREATE INDEX CONCURRENTLY customers_tenant_created ON customers (tenant_id, created_at DESC);
```

Sau đó: `Index Scan using customers_tenant_created`, 12 buffer, 0,06 ms. Cùng bài kiểm tải ở mục 4 (tăng dần lên 150 request/giây trong 15 giây rồi giữ 30 giây):

| | Trước | Sau |
|---|---|---|
| p95 | 2,74 giây | 1,97 ms |
| Request/giây trung bình cả bài | 76 (k6 bỏ 2.068 lượt vì server không theo kịp) | 126, đúng bằng mức đặt ra (không bỏ lượt nào) |
| Ngưỡng `p(95)<300` | Không đạt, k6 thoát mã 99 | Đạt |

Những nguyên nhân hay gặp khác: N+1 query qua ORM (skill `backend`, `orm.md`), phân trang bằng `OFFSET` trên bảng lớn, `count(*)` cả bảng cho mỗi trang, thiếu index trên cột FK, transaction giữ lâu khi gọi API ngoài, pool kết nối quá nhỏ (request xếp hàng chờ) hoặc quá lớn (DB quá tải). Tạo index trên bảng đang chạy luôn dùng `CONCURRENTLY` trong migration riêng (`release-rollback.md`).

## 4. Kiểm tải bằng k6

```js
// load/customers-list.js — chạy: k6 run -e BASE_URL=https://staging.example.vn load/customers-list.js
import http from 'k6/http';
import { check } from 'k6';

// Mỗi tenant một token đăng nhập của tài khoản test trên staging (tạo bằng script seed, không dùng tài khoản thật)
const TENANTS = JSON.parse(open('./tenants.json'));
const BASE_URL = __ENV.BASE_URL;

export const options = {
  scenarios: {
    list_customers: {
      executor: 'ramping-arrival-rate',   // giữ đúng số request/giây dù server chậm đi
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: Number(__ENV.RPS || 100), duration: __ENV.RAMP || '30s' },   // tăng dần lên mức mục tiêu
        { target: Number(__ENV.RPS || 100), duration: __ENV.HOLD || '1m' },    // giữ ở mức đó
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                               // dưới 1% lỗi
    'http_req_duration{name:customers_list}': ['p(95)<300'],      // p95 dưới 300 ms
  },
};

export default function () {
  const tenant = TENANTS[Math.floor(Math.random() * TENANTS.length)];   // trải đều các tenant như thật
  const res = http.get(`${BASE_URL}/v1/t/${tenant.id}/customers?limit=20`, {
    headers: { authorization: `Bearer ${tenant.token}` },
    tags: { name: 'customers_list' },                                    // gom các URL khác tenant vào một nhóm số liệu
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

```bash
k6 run -e BASE_URL=https://staging.example.vn load/customers-list.js        # tải mục tiêu
k6 run -e BASE_URL=... -e RPS=5 -e RAMP=10s -e HOLD=1m load/customers-list.js   # smoke sau mỗi lần deploy staging
```

Đọc kết quả:

- k6 thoát mã khác 0 khi một ngưỡng trong `thresholds` không đạt: dùng mã thoát để CI đỏ.
- `dropped_iterations` lớn hơn 0 nghĩa là không đạt được số request/giây đặt ra (server chậm làm hết VU); đó cũng là dấu hiệu quá tải, kể cả khi p95 trông ổn.
- Theo dõi CPU, kết nối DB, bộ nhớ của app và DB trong lúc chạy: chỗ nào chạm trần trước là nút thắt.

Các loại bài:

| Bài | Mức | Thời gian | Khi nào |
|---|---|---|---|
| Smoke | Vài request/giây | 1 phút | Sau mỗi lần deploy staging |
| Tải mục tiêu | Mức ở mục 1 | 15 đến 30 phút | Trước release lớn, sau thay đổi DB hoặc hạ tầng |
| Tìm giới hạn | Tăng dần đến khi vỡ | Đến khi lỗi hoặc p95 vượt ngưỡng | Lập kế hoạch dung lượng |
| Ngâm lâu | Mức bình thường | Vài giờ | Nghi rò bộ nhớ, rò kết nối |

Quy tắc:

- Chạy trên **staging có lượng dữ liệu giống production** (script seed tạo đủ tenant, khách, lịch hẹn). Bảng nhỏ thì query nào cũng nhanh.
- Không chạy vào production nếu chưa lên kế hoạch và báo trước; không bắn tải vào API bên thứ ba (cổng thanh toán, SMS): dùng sandbox hoặc giả lập trên staging.
- Trải request ra nhiều tenant và nhiều tài khoản như thật, gồm cả đăng nhập; tài khoản test riêng, không dùng tài khoản thật.
- Ghi kết quả (p95, request/giây, lỗi, cấu hình máy) vào `docs/releases/` để so giữa các lần.

Chạy theo lịch hoặc bấm tay trong GitHub Actions:

```yaml
# .github/workflows/load-test.yml — chạy tay hoặc mỗi đêm trên staging, không chạy ở mọi PR
name: Load test
on:
  workflow_dispatch:
    inputs:
      rps:
        description: Số request mỗi giây ở mức giữ
        default: "100"
  schedule:
    - cron: "30 19 * * *"   # 02:30 giờ Việt Nam, lúc staging vắng
permissions:
  contents: read
jobs:
  k6:
    runs-on: ubuntu-latest
    environment: staging                       # token test lấy từ secret của environment này
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

## 5. Hiệu năng trang web

Hai nguồn số liệu, dùng cả hai:

- **Phòng lab** (CI): đo trên máy CI với CPU và mạng giả lập chậm, để bắt thụt lùi trước khi merge. Không đo được INP (cần tương tác thật).
- **Người dùng thật**: thư viện `web-vitals` gửi số đo về server; đây là số dùng để so với mục tiêu ở mục 1.

Ngân sách chạy trong CI bằng Playwright (thêm vào bộ E2E, skill `build`, `e2e-playwright.md`):

```ts
// tests/perf/customers.perf.spec.ts — ngân sách hiệu năng chạy ở CI (số đo trong phòng lab, dùng để bắt thụt lùi)
import { expect, test } from '@playwright/test';

test('trang danh sách khách: LCP và CLS trong ngân sách', async ({ page }) => {
  // Giả lập máy yếu và mạng 4G chậm, để máy CI mạnh không che mất vấn đề
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
        setTimeout(() => resolve({ lcp, cls }), 500);   // đợi các entry buffered được giao
      }),
  );

  expect(lcp, 'LCP (ms)').toBeLessThan(2500);
  expect(cls, 'CLS').toBeLessThan(0.1);
});
```

Thử trên một trang có banner chèn vào sau khi tải: CLS đo được 0,23 và test fail như mong đợi.

Số đo từ người dùng thật:

```ts
// apps/web/src/report-web-vitals.ts — gọi một lần khi app khởi động
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

// Số đo từ trình duyệt thật của người dùng: nguồn đúng nhất cho INP (cần tương tác thật)
function send(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,        // LCP | INP | CLS
    value: metric.value,
    rating: metric.rating,    // good | needs-improvement | poor
    id: metric.id,
    page: location.pathname,  // chỉ đường dẫn, không gửi query string (có thể chứa dữ liệu cá nhân)
  });
  // sendBeacon vẫn gửi được khi người dùng đóng tab
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

Server lưu các số này (hoặc gửi sang công cụ analytics), báo cáo phân vị 75 theo trang. Sửa thường gặp:

- **LCP**: ảnh chính đúng kích thước và định dạng hiện đại, không lazy-load ảnh đầu trang; render dữ liệu đầu tiên từ server; giảm JavaScript chặn hiển thị.
- **CLS**: đặt sẵn chiều cao cho ảnh, banner, khung quảng cáo, khung chờ tải; không chèn nội dung lên trên nội dung đang hiển thị.
- **INP**: chia nhỏ việc nặng trên luồng chính, không render lại cả danh sách dài cho mỗi phím gõ (skill `frontend`, `state-management.md`), dùng danh sách ảo cho danh sách rất dài.
- Ngân sách kích thước bundle: so kích thước file build giữa các PR; tách code theo route.

## 6. Khi nào mới cần mở rộng hạ tầng

Theo thứ tự, chỉ sang bước sau khi đo được bước trước không đủ:

1. Sửa query, thêm index, bỏ N+1 (mục 3).
2. Cache: header HTTP cho dữ liệu công khai; cache trong app cho dữ liệu đọc nhiều, khoá luôn có `tenant_id`, có cách xoá khi dữ liệu đổi.
3. Đưa việc chậm ra job nền (skill `backend`, `jobs.md`).
4. Máy lớn hơn (CPU, RAM cho DB thường rẻ hơn công sức kiến trúc).
5. Thêm instance app (app không giữ trạng thái trong bộ nhớ), connection pooler cho DB (PgBouncer).
6. Read replica cho báo cáo, truy vấn đọc nặng.
7. Tách dịch vụ, chia nhỏ dữ liệu: chỉ khi có số đo và lý do rõ, ghi ADR (skill `architecture`).
