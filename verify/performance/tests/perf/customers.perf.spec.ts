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
