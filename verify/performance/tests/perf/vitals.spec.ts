import { expect, test } from '@playwright/test';
test('gửi LCP và CLS về server khi người dùng rời trang', async ({ page }) => {
  const sent: { name: string; page: string }[] = [];
  await page.route('**/v1/vitals', async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: 204 });
  });
  await page.goto('/customers');
  await page.getByRole('heading', { name: 'Khách hàng' }).click();   // tương tác đầu tiên: LCP được chốt
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => sent.map((m) => m.name)).toEqual(expect.arrayContaining(['CLS', 'LCP']));
  expect(sent.every((m) => m.page === '/customers')).toBe(true);
});
