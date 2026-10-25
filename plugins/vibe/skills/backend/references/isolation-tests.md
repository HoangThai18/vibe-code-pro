# Test cô lập tenant

Mục tiêu: chứng minh bằng test rằng tenant A không đọc, sửa, xoá hay liệt kê được dữ liệu của tenant B, qua API lẫn trực tiếp ở DB. Viết test dạng bảng để route mới chỉ cần thêm một dòng là có test.

## 1. Seed hai tenant

```ts
// test/helpers/tenants.ts (ví dụ: vitest + supertest; đổi theo stack của dự án)
export async function seedTwoTenants() {
  const a = await createTenantWithUser('tenant-a');   // { tenantId, token }
  const b = await createTenantWithUser('tenant-b');
  const aCustomer = await createCustomer(a, { name: 'Khách của A', email: 'a@example.com' });
  const bCustomer = await createCustomer(b, { name: 'Khách của B', email: 'b@example.com' });
  return { a, b, aCustomer, bCustomer };
}
```

Seed bằng code của app (hoặc SQL với đúng tenant context), không chèn dữ liệu bằng superuser bỏ qua ràng buộc; như vậy test mới phản ánh đường đi thật.

## 2. Test API dạng bảng, có đối chứng

Tenant nằm trong path (`/v1/t/{tenantId}/...`, skill backend `api-conventions.md` mục 5), nên có **hai** đường tấn công phải chặn: gắn id của B vào path của chính A (tenant scope/RLS chặn), và gọi thẳng path của B (kiểm membership chặn).

Test cô lập cũng dễ pass mà không kiểm gì: route viết sai path cũng trả 404, danh sách rỗng cũng "không chứa dữ liệu của B". Vì vậy mỗi kiểm tra âm đi kèm một **đối chứng dương**: cùng request đó bằng chủ sở hữu phải thành công.

```ts
// test/customers.isolation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { seedTwoTenants } from './helpers/tenants';

// Seed lại cho từng test để các test không phụ thuộc thứ tự chạy
let ctx: Awaited<ReturnType<typeof seedTwoTenants>>;
beforeEach(async () => { ctx = await seedTwoTenants(); });

type Route = {
  name: string;
  method: 'get' | 'patch' | 'post' | 'delete';
  path: (tenantId: string, id: string) => string;
  body?: object;
};

// Mỗi route có :id của tài nguyên tenant → thêm một dòng (đúng các route app đang có)
const crossTenantRoutes: Route[] = [
  { name: 'GET customers/:id', method: 'get', path: (t, id) => `/v1/t/${t}/customers/${id}` },
  { name: 'PATCH customers/:id', method: 'patch', path: (t, id) => `/v1/t/${t}/customers/${id}`, body: { name: 'hack' } },
  { name: 'POST customers/:id/archive', method: 'post', path: (t, id) => `/v1/t/${t}/customers/${id}/archive` },
];

function call(route: Route, tenantId: string, id: string, token: string) {
  const req = request(app)[route.method](route.path(tenantId, id)).set('Authorization', `Bearer ${token}`);
  return route.body ? req.send(route.body) : req;
}

describe('cô lập tenant: customers', () => {
  it.each(crossTenantRoutes)('$name: tenant A không chạm được dữ liệu của B', async (route) => {
    // 1. id của B trong path của A (A là thành viên của A): tenant scope / RLS phải chặn
    expect((await call(route, ctx.a.tenantId, ctx.bCustomer.id, ctx.a.token)).status).toBe(404);
    // 2. path của B (A không phải thành viên): kiểm membership phải chặn
    expect((await call(route, ctx.b.tenantId, ctx.bCustomer.id, ctx.a.token)).status).toBe(404);

    // Trả 404 chưa đủ: dữ liệu của B không bị đổi
    const fromB = await call(crossTenantRoutes[0]!, ctx.b.tenantId, ctx.bCustomer.id, ctx.b.token);
    expect(fromB.body.data).toMatchObject({ name: 'Khách của B', status: 'active' });

    // Đối chứng: chính B gọi đúng request đó thì thành công. Thiếu bước này,
    // route sai path hoặc chưa tồn tại cũng trả 404 và test pass mà không kiểm gì.
    const own = await call(route, ctx.b.tenantId, ctx.bCustomer.id, ctx.b.token);
    expect(own.status).toBeLessThan(300);
  });

  it('danh sách của A có dữ liệu của A, không có của B; A không đọc được danh sách của B', async () => {
    const res = await request(app).get(`/v1/t/${ctx.a.tenantId}/customers?limit=100`)
      .set('Authorization', `Bearer ${ctx.a.token}`);
    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(ctx.aCustomer.id);        // đối chứng: danh sách rỗng thì test này fail
    expect(ids).not.toContain(ctx.bCustomer.id);

    const other = await request(app).get(`/v1/t/${ctx.b.tenantId}/customers`)
      .set('Authorization', `Bearer ${ctx.a.token}`);
    expect(other.status).toBe(404);
  });

  it('tenantId client gửi trong body bị bỏ qua', async () => {
    const res = await request(app).post(`/v1/t/${ctx.a.tenantId}/customers`)
      .set('Authorization', `Bearer ${ctx.a.token}`)
      .send({ name: 'Tạo lậu', tenantId: ctx.b.tenantId });
    expect(res.status).toBe(201);
    const get = crossTenantRoutes[0]!;
    expect((await call(get, ctx.a.tenantId, res.body.data.id, ctx.a.token)).status).toBe(200);   // thuộc A
    expect((await call(get, ctx.b.tenantId, res.body.data.id, ctx.b.token)).status).toBe(404);   // không thuộc B
  });

  it('không gắn được tham chiếu sang tài nguyên của tenant khác', async () => {
    const orders = `/v1/t/${ctx.a.tenantId}/orders`;
    const cross = await request(app).post(orders).set('Authorization', `Bearer ${ctx.a.token}`)
      .send({ customerId: ctx.bCustomer.id, items: [] });
    expect([400, 404, 422]).toContain(cross.status);
    const own = await request(app).post(orders).set('Authorization', `Bearer ${ctx.a.token}`)   // đối chứng
      .send({ customerId: ctx.aCustomer.id, items: [] });
    expect(own.status).toBe(201);
  });
});
```

Muốn chặt hơn: đọc danh sách route từ router của app và assert route nào có `:id` cũng nằm trong bảng `crossTenantRoutes`, để route mới quên thêm test sẽ làm CI đỏ.

## 3. Test RLS trực tiếp ở DB

Chạy bằng **role app** (không phải superuser):

```sql
-- 0. Đối chứng: context tenant B thấy dòng của B (nếu 0 thì các kiểm tra dưới không chứng minh gì)
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_b', true);
SELECT count(*) > 0 AS should_be_true FROM customers WHERE tenant_id = :'tenant_b';
ROLLBACK;

-- 1. Không có context → 0 dòng
BEGIN;
SELECT count(*) AS should_be_zero FROM customers;
ROLLBACK;

-- 2. Context tenant A → không thấy dòng của B
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
SELECT count(*) AS should_be_zero FROM customers WHERE tenant_id = :'tenant_b';
ROLLBACK;

-- 3. Context tenant A → không insert được dòng mang tenant B (lỗi vi phạm policy)
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
INSERT INTO customers (tenant_id, email) VALUES (:'tenant_b', 'x@example.com');
ROLLBACK;
```

(Cú pháp `:'tenant_a'` là biến của psql: `psql -v tenant_a=... -v tenant_b=...`. Trong test code thì truyền tham số như bình thường.)

## 4. Checklist cho mỗi bảng hoặc endpoint mới
- [ ] Đọc / sửa / xoá chéo tenant → 404 theo cả hai đường (id của B trong path của A; path của B), kèm đối chứng: chủ sở hữu gọi cùng request thì thành công
- [ ] Danh sách có dữ liệu của tenant hiện tại và không có của tenant khác
- [ ] `tenantId` từ client bị bỏ qua
- [ ] Tham chiếu chéo tenant bị từ chối (composite FK)
- [ ] Bảng mới nằm ngoài kết quả câu kiểm tra RLS ở `postgres-rls.md` mục 8
- [ ] Test chạy bằng role app, không phải superuser
