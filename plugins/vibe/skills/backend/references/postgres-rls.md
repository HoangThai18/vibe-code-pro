# Postgres RLS cho multi-tenant: chi tiết và bẫy

Mọi đoạn SQL trong file này đã chạy thử trên PostgreSQL 16, kể cả các phép thử "tấn công" nêu trong mục Bẫy.

## Mục lục
1. Role và quyền
2. Policy cho bảng thuộc tenant
3. Đăng nhập và chọn workspace (trước khi có tenant)
4. Set tenant context theo request: pg, Prisma, Drizzle, SQLAlchemy, Django
5. Migration dữ liệu, backfill, backup khi đã bật FORCE
6. Supabase
7. Bẫy thường gặp
8. Câu lệnh kiểm tra nhanh

## 1. Role và quyền

Tách bốn vai trò:

| Role | Dùng cho | Thuộc tính |
|---|---|---|
| owner của bảng (vd `app_owner`) | chạy migration schema (DDL) | không superuser |
| `app_user` | app lúc chạy | `NOSUPERUSER NOBYPASSRLS`, không phải owner |
| `app_backup` | `pg_dump` | `BYPASSRLS` + `pg_read_all_data` (chỉ đọc, gồm cả bảng tạo sau này) |
| `app_maintenance` | backfill dữ liệu, job vận hành có duyệt | `BYPASSRLS` + `pg_read_all_data` + `pg_write_all_data`, chỉ dùng có chủ đích (mục 5) |

```sql
CREATE ROLE app_user LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Bảng và sequence do migration (app_owner) tạo sau này. Phải ghi FOR ROLE: thiếu nó thì
-- default chỉ áp cho object do chính người đang chạy lệnh tạo (vd admin), không áp cho app_owner.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
-- Chặn query treo ảnh hưởng tenant khác
ALTER ROLE app_user SET statement_timeout = '5s';

-- Backup và backfill (Postgres 14+): role có sẵn pg_read_all_data/pg_write_all_data áp cho mọi bảng,
-- kể cả bảng tạo sau này, nên không bị "permission denied" khi có bảng mới. Tạo BYPASSRLS cần superuser.
CREATE ROLE app_backup LOGIN PASSWORD 'change-me' BYPASSRLS;
GRANT pg_read_all_data TO app_backup;
CREATE ROLE app_maintenance LOGIN PASSWORD 'change-me' BYPASSRLS;
GRANT pg_read_all_data, pg_write_all_data TO app_maintenance;
```

DB managed (RDS, Cloud SQL, Neon, Supabase...) thường có sẵn role riêng; nguyên tắc giữ nguyên: role của app không được bypass RLS.

## 2. Policy cho bảng thuộc tenant

```sql
-- Đọc tenant hiện tại. NULLIF: sau khi transaction có set_config(..., true) kết thúc,
-- connection đó trả về '' thay vì NULL, và ''::uuid sẽ báo lỗi.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;   -- áp dụng cả với owner của bảng

CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

- Không có context thì `app_current_tenant()` là NULL, điều kiện thành NULL, kết quả 0 dòng (fail closed).
- `(SELECT ...)` giúp Postgres tính giá trị một lần cho cả câu lệnh thay vì từng dòng.
- Với bảng nghiệp vụ thông thường, một policy `FOR ALL` chỉ so `tenant_id` như trên là đủ và an toàn.
- **Đừng thêm điều kiện `OR ...` vào một policy `FOR ALL`.** Điều kiện `USING` cũng quyết định dòng nào được UPDATE/DELETE, nên mọi nhánh `OR` mở rộng quyền ghi chứ không chỉ quyền đọc. Cần đọc rộng hơn thì tách riêng policy `FOR SELECT` (mục 3).
- Có thể cho `tenant_id` tự điền: `tenant_id uuid NOT NULL DEFAULT app_current_tenant()`. Policy vẫn kiểm ở `WITH CHECK`.

## 3. Đăng nhập và chọn workspace (trước khi có tenant)

Lúc đăng nhập hoặc chọn workspace chưa có tenant context, nhưng vẫn cần liệt kê các tenant mà user là thành viên. Cách làm:

- **Chỉ ở luồng đăng nhập / chọn workspace**, server set `app.user_id` (lấy từ phiên đã xác thực, theo transaction). Request nghiệp vụ thông thường chỉ set `app.tenant_id` (tenant trong path, kiểm membership như mục 4). Như vậy query "danh sách thành viên của workspace" không bao giờ lẫn membership của user ở tenant khác.
- `memberships` và `tenants` có **policy đọc** cho phép theo user, còn **policy ghi** chỉ theo tenant hiện tại:

```sql
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (tenant_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user()));
CREATE POLICY membership_insert ON memberships FOR INSERT
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_delete ON memberships FOR DELETE
  USING (tenant_id = (SELECT app_current_tenant()));

-- tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenants FOR SELECT
  USING (id = (SELECT app_current_tenant())
         OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = (SELECT app_current_user())));
CREATE POLICY tenant_insert ON tenants FOR INSERT
  WITH CHECK (id = (SELECT app_current_tenant()));
CREATE POLICY tenant_update ON tenants FOR UPDATE
  USING (id = (SELECT app_current_tenant()))
  WITH CHECK (id = (SELECT app_current_tenant()));
CREATE POLICY tenant_delete ON tenants FOR DELETE
  USING (id = (SELECT app_current_tenant()));
```

- **Liệt kê workspace của user**: chỉ set `app.user_id`, rồi query `memberships JOIN tenants`.
- **Đăng ký tenant mới**: sinh id tenant ở app, set `app.tenant_id` = id mới trong transaction, rồi insert `tenants` và membership owner. Insert membership cho tenant khác bị policy chặn.
- **Tra tenant theo slug/subdomain trước khi đăng nhập**: slug và tên miền vốn công khai (nằm ngay trên URL), nên tách ra một bảng ánh xạ nhỏ không bật RLS, app chỉ được đọc. Cách này đơn giản hơn function `SECURITY DEFINER` + role BYPASSRLS, và không vướng quyền sở hữu khi backup/restore (mục 7, bẫy 8).

```sql
CREATE TABLE tenant_domains (
  slug      text PRIMARY KEY,          -- vd 'spa-hoa-mai' hoặc 'hoamai.example.com'
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);
-- Chỉ đọc. ALTER DEFAULT PRIVILEGES ở mục 1 đã cấp cả quyền ghi cho app_user trên mọi bảng mới,
-- nên phải thu lại: bảng này không có RLS, ghi được là đổi được slug của tenant khác sang tenant mình.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tenant_domains FROM app_user;
GRANT SELECT ON tenant_domains TO app_user;
-- Thêm/đổi slug: luồng quản trị riêng (role khác hoặc function có kiểm quyền), có audit log
```

  Không đưa vào bảng này thứ gì ngoài slug và id. Sau khi có `tenant_id` từ slug, server vẫn phải kiểm user có membership trong tenant đó.

## 4. Set tenant context theo request

Nguyên tắc: mỗi request (hoặc unit of work) chạy trong một transaction, câu đầu tiên là `set_config('app.tenant_id', <tenant>, true)`. Tham số thứ ba `true` giới hạn giá trị trong transaction, nên connection trả về pool không còn mang tenant cũ.

Tenant lấy từ path của request (`/v1/t/{tenantId}/...`, validate là uuid trước, sai định dạng → 404). Ngay sau `set_config`, trong cùng transaction, kiểm user của phiên là thành viên: policy đọc `memberships` theo tenant hiện tại nên câu dưới chỉ thấy membership của đúng tenant đó, không có dòng nào nghĩa là user không thuộc tenant này → 404.

### node-postgres (pg)

```ts
import type { Pool, PoolClient } from 'pg';

export async function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Middleware cho request nghiệp vụ: tenant từ path, user từ phiên đã xác thực (NotFoundError là lỗi của dự án, map sang 404)
export async function withMember<T>(
  pool: Pool, tenantId: string, userId: string,
  fn: (db: PoolClient, role: string) => Promise<T>,
): Promise<T> {
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ role: string }>('SELECT role FROM memberships WHERE user_id = $1', [userId]);
    if (rows.length === 0) throw new NotFoundError();   // không phải thành viên: 404, không lộ tenant có tồn tại
    return fn(db, rows[0]!.role);
  });
}
```

### Prisma

Dùng interactive transaction trên client gốc: mọi query của một unit of work đi qua `tx`, câu đầu tiên set tenant. Cách khởi tạo `PrismaClient` khác nhau giữa các bản major (Prisma 7 dùng driver adapter và import từ thư mục client được generate), nên tạo client theo tài liệu của đúng version đang cài.

```ts
import type { Prisma, PrismaClient } from '<đường dẫn client đã generate>';

export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

// tenantId lấy từ path và đã kiểm membership như ví dụ pg ở trên
// await withTenant(prisma, tenantId, (tx) => tx.customer.findMany({ take: 20 }));
```

Mẫu "client extension bọc mọi query" trong ví dụ của Prisma chỉ là minh hoạ: mỗi query thành một transaction riêng, và chính tài liệu của ví dụ đó cảnh báo `$transaction` trên client đã extend có thể không chạy như mong muốn và không dành cho production. Đừng dùng nó làm lớp cô lập tenant chính.

### Drizzle

```ts
import { sql } from 'drizzle-orm';

await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  // ...mọi query dùng tx
});
```

### TypeORM

```ts
await dataSource.transaction(async (manager) => {
  await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  // ...mọi thao tác dùng manager
});
```

### Sequelize

```js
await sequelize.transaction(async (t) => {
  await sequelize.query("SELECT set_config('app.tenant_id', :tid, true)", { replacements: { tid: tenantId }, transaction: t });
  // ...mọi lệnh phải truyền { transaction: t }
});
```

### GORM (Go)

```go
err := db.Transaction(func(tx *gorm.DB) error {
    if err := tx.Exec("SELECT set_config('app.tenant_id', ?, true)", tenantID).Error; err != nil {
        return err
    }
    // ...mọi query dùng tx
    return nil
})
```

### ActiveRecord (Rails)

```ruby
ActiveRecord::Base.transaction do
  ActiveRecord::Base.connection.execute(
    ActiveRecord::Base.sanitize_sql_array(["SELECT set_config('app.tenant_id', ?, true)", tenant_id])
  )
  # ...mọi query trong khối này
end
```

### SQLAlchemy

```python
from sqlalchemy import text

with Session(engine) as session, session.begin():
    session.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant_id)})
    # ...mọi query trong cùng transaction
```

### Django

Với `ATOMIC_REQUESTS = True`, transaction chỉ bọc view, còn middleware chạy bên ngoài nó. Vì vậy hãy set context bên trong view (decorator hoặc mixin dùng chung):

```python
from functools import wraps
from django.db import connection, transaction

def tenant_scoped(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("SELECT set_config('app.tenant_id', %s, true)", [str(request.tenant_id)])
            return view(request, *args, **kwargs)
    return wrapper
```

## 5. Migration dữ liệu, backfill, backup khi đã bật FORCE

`FORCE ROW LEVEL SECURITY` áp policy lên cả owner của bảng. Hệ quả dễ bỏ sót:

- **Backfill chạy bằng role owner, không có tenant context, sẽ UPDATE 0 dòng mà không báo lỗi.** Nếu bước "contract" sau đó xoá cột cũ, dữ liệu mất thật.
- **`pg_dump` bằng role owner** báo lỗi `query would be affected by row-level security policy`.

Cách làm:

- Chạy backfill bằng `app_maintenance` và backup bằng `app_backup` (mục 1), hoặc chạy backfill theo từng tenant với `set_config('app.tenant_id', ..., true)` trong mỗi transaction.
- **Luôn kiểm số dòng bị ảnh hưởng** của backfill (so với `count(*)` chạy bằng `app_maintenance`) trước khi chuyển sang bước tiếp theo.
- Migration chỉ có DDL (CREATE/ALTER) không bị ảnh hưởng.

## 6. Supabase

Client gọi thẳng DB qua API của Supabase, nên RLS là lớp bảo vệ chính, không chỉ là lưới an toàn.

- Bật RLS cho mọi bảng trong schema `public`. Bảng chưa bật RLS là bảng mà ai có anon key cũng đọc được.
- Policy dựa trên `auth.uid()` và bảng memberships. Gom danh sách tenant của user vào một function `SECURITY DEFINER` trả về tập id, rồi dùng `IN (SELECT ...)`: Postgres tính danh sách một lần cho cả câu lệnh. Nếu gọi function kiểm tra cho từng dòng (vd `is_member(tenant_id)`) thì bảng lớn sẽ chậm rõ rệt. Function tạo từ SQL editor thuộc role `postgres` của Supabase, vốn bỏ qua RLS, nên đọc được memberships.
- Đặt function đó trong một schema **không được expose qua API** (vd `private`), vì function ở schema `public` có thể bị gọi thẳng như một RPC.
  ```sql
  CREATE SCHEMA IF NOT EXISTS private;
  GRANT USAGE ON SCHEMA private TO authenticated;

  CREATE OR REPLACE FUNCTION private.user_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()
  $$;

  CREATE POLICY members_only ON public.customers FOR ALL TO authenticated
    USING (tenant_id IN (SELECT private.user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT private.user_tenant_ids()));
  ```
  Policy này cho user thấy dữ liệu của mọi tenant họ là thành viên. Màn hình làm việc trong một workspace vẫn phải lọc thêm `tenant_id` của workspace đang chọn.
- Không bao giờ để `service_role` key ở client hay trong code FE: key đó bỏ qua toàn bộ RLS.
- Edge Function hay server dùng `service_role` thì phải tự kiểm membership trong code.

## 7. Bẫy thường gặp

1. **Test bằng superuser**: RLS bị bỏ qua, test pass dù policy sai. Chạy test bằng role app.
2. **Policy ép kiểu thẳng `current_setting(...)::uuid`**: sau khi một transaction có `set_config(..., true)` kết thúc, connection đó trả về `''` chứ không phải NULL, và query tiếp theo lỗi `invalid input syntax for type uuid`. Luôn dùng `NULLIF(..., '')` như mục 2.
3. **`OR` trong policy `FOR ALL`**: nhánh `OR` cũng mở quyền UPDATE/DELETE. Ví dụ policy `memberships` có `OR user_id = app_current_user()` sẽ cho user dời membership owner của mình từ tenant B sang tenant A. Tách policy đọc và ghi như mục 3.
4. **`SET app.tenant_id = ...` theo session + PgBouncer transaction pooling**: request sau nhận tenant của request trước. Dùng `set_config(..., true)` trong transaction.
5. **FK thường không chặn tham chiếu chéo tenant**: kiểm tra FK bỏ qua RLS, nên `customer_id REFERENCES customers(id)` vẫn nhận id khách của tenant khác. Phải dùng composite FK `(tenant_id, customer_id)`.
6. **Unique global làm lộ dữ liệu**: tenant A insert trùng email của tenant B sẽ nhận lỗi unique, tức là biết B có email đó. Unique phải kèm `tenant_id`.
7. **View vượt RLS** khi owner của view là superuser hoặc có BYPASSRLS, hoặc là owner của bảng mà bảng không `FORCE`. Postgres 15+ tạo view đọc bảng tenant bằng `WITH (security_invoker = true)` để khỏi phải nghĩ.
8. **Function `SECURITY DEFINER`** chạy với quyền owner của function: owner có BYPASSRLS thì vượt RLS; owner là owner bảng thì vượt RLS nếu bảng không `FORCE`, còn có `FORCE` thì bị chặn và trả rỗng. Function thuộc role đặc biệt còn dễ hỏng khi restore bằng user không phải superuser (đổi owner cần role đó có quyền `CREATE` trên schema). Ưu tiên thiết kế không cần nó (mục 3); nếu buộc phải dùng thì giữ function thật hẹp, luôn `SET search_path`, chỉ nhận tham số đã xác thực, và đưa vào bài diễn tập restore.
9. **Backfill bằng owner khi có `FORCE`**: 0 dòng được cập nhật, không có lỗi (mục 5).
10. **Bảng mới quên bật RLS**: thêm câu kiểm tra ở mục 8 vào CI.
11. **Materialized view, replica cho analytics, dump/export**: không tự áp RLS như bảng gốc; lọc theo tenant ở bước tạo hoặc khi truy cập.
12. **Hiệu năng**: policy gọi function cho từng dòng và thiếu index có `tenant_id` đứng đầu sẽ chậm khi bảng lớn.

## 8. Câu lệnh kiểm tra nhanh

Bảng có cột `tenant_id` mà chưa bật RLS hoặc chưa `FORCE` (đưa vào CI, kết quả phải rỗng; bảng được miễn có chủ đích như `tenant_domains` thì liệt kê trong `NOT IN`, và phải có thêm kiểm tra riêng rằng role app chỉ đọc được bảng đó, như câu thứ tư bên dưới):

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname NOT IN ('tenant_domains')   -- bảng miễn RLS có chủ đích
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
```

Bảng đã bật RLS nhưng chưa có policy nào (mọi truy vấn sẽ trả 0 dòng):

```sql
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname);
```

Role app có bypass không (cả hai cột phải là false):

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
```

Bảng miễn RLS mà role app vẫn ghi được (kết quả phải rỗng):

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'app_user' AND table_schema = 'public'
  AND table_name IN ('tenant_domains')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
```
