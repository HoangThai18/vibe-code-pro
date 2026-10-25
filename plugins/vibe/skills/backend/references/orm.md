# Dùng ORM cho đúng

ORM giúp viết nhanh, nhưng giấu SQL thật phía sau. Ba lỗi phổ biến nhất: N+1 query, transaction dùng sai, và migration tự sinh chạy mà không ai đọc. Các ví dụ dưới đây đã chạy trên PostgreSQL 16 với Prisma 7.10, Drizzle 0.45, TypeORM 1.1, Sequelize 6.37, SQLAlchemy 2.1, Django 6.1, GORM 1.31, ActiveRecord 8.1, gồm cả trường hợp hai transaction trừ kho cùng lúc. Bản khác thì **kiểm lại theo version đang cài** (tài liệu chính thức hoặc file type trong `node_modules`) trước khi dùng.

## Mục lục
1. Nguyên tắc chung
2. Prisma
3. Drizzle
4. TypeORM
5. Sequelize
6. SQLAlchemy 2.x
7. Django ORM
8. GORM (Go)
9. ActiveRecord (Rails)
10. Connection pool và serverless

## 1. Nguyên tắc chung

- **Bật log SQL ở môi trường dev** và nhìn số query của một request. Danh sách 20 dòng mà chạy 21 query là N+1.
- **Chỉ lấy cột cần dùng** (`select`) cho danh sách lớn và API công khai, để vừa nhanh vừa không vô tình trả trường nhạy cảm.
- **Raw SQL được phép** cho query phức tạp (báo cáo, CTE, window function), nhưng luôn có tham số (parameterized); không nối chuỗi.
- **Migration tự sinh phải được đọc**: ORM có thể biến "đổi tên cột" thành "xoá cột + thêm cột" và làm mất dữ liệu.
- **Không dùng chế độ đồng bộ schema tự động ở production** (`synchronize`, `sync({ alter: true })`, `db push`, `AutoMigrate`): chúng không có lịch sử và có thể xoá dữ liệu.
- Transaction: mọi query trong transaction phải đi qua đối tượng transaction (`tx`), không qua client gốc; dùng nhầm client gốc thì query đó chạy ngoài transaction.
- **Trừ số lượng (kho, lượt, số dư) bằng một câu UPDATE có điều kiện và kiểm số dòng bị ảnh hưởng**: `UPDATE ... SET qty = qty - 1 WHERE ... AND qty >= 1`; 0 dòng nghĩa là không đủ, ném lỗi để rollback cả transaction. Đọc số lượng ra, kiểm ở code rồi mới ghi thì hai request đồng thời cùng lọt qua. Thêm `CHECK (qty >= 0)` ở DB làm lưới cuối. Các ví dụ dưới đều theo cách này; `OutOfStockError` là lỗi nghiệp vụ của dự án.

## 2. Prisma

```ts
// Tránh N+1: lấy kèm quan hệ trong một lần gọi
const customers = await prisma.customer.findMany({
  where: { status: 'active' },
  select: { id: true, name: true, orders: { select: { id: true, total: true } } },
  take: 20,
});

// Transaction tương tác: mọi query dùng tx
const order = await prisma.$transaction(async (tx) => {
  const { count } = await tx.stock.updateMany({
    where: { productId, qty: { gte: 1 } },
    data: { qty: { decrement: 1 } },
  });
  if (count === 0) throw new OutOfStockError(productId);   // ném lỗi = rollback
  return tx.order.create({ data: { customerId, total } });
});

// Raw SQL có tham số (tagged template). Tránh $queryRawUnsafe với input người dùng.
const rows = await prisma.$queryRaw`SELECT id FROM customers WHERE email = ${email}`;
```

- Prisma 7: client sinh ra từ `generator "prisma-client"` có `output`, URL kết nối đặt trong `prisma.config.ts`, và khởi tạo bằng driver adapter (`new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`).
- Cài CLI `prisma` **cùng major** với `@prisma/client` (vd `prisma@7`) và kiểm `npx prisma --version`: đã gặp trường hợp tag `latest` của gói `prisma` trỏ tới bản RC của major mới, thiếu lệnh `generate` và `migrate`.
- Migration: `prisma migrate dev --create-only` để sinh SQL rồi đọc/sửa trước khi áp; production chạy `prisma migrate deploy`. `prisma db push` chỉ dùng cho prototype.
- `CREATE INDEX CONCURRENTLY` và các lệnh không chạy được trong transaction: viết SQL tay trong migration và đọc tài liệu Prisma về cách tách transaction cho migration đó.

## 3. Drizzle

```ts
import { and, eq, gte, sql } from 'drizzle-orm';

// Relational query: lấy kèm quan hệ (cần khai báo relations)
const list = await db.query.customers.findMany({
  where: (c, { eq }) => eq(c.status, 'active'),
  with: { orders: true },
  limit: 20,
});

await db.transaction(async (tx) => {
  const updated = await tx.update(stock)
    .set({ qty: sql`${stock.qty} - 1` })
    .where(and(eq(stock.productId, productId), gte(stock.qty, 1)))
    .returning({ productId: stock.productId });            // returning: Postgres, SQLite
  if (updated.length === 0) throw new OutOfStockError(productId);
  await tx.insert(orders).values({ customerId, total });
});

const result = await db.execute(sql`SELECT id FROM customers WHERE email = ${email}`);
// driver node-postgres: các dòng nằm ở result.rows; driver postgres-js: result là mảng
```

- Drizzle 1.0 đổi relational query (vd `where: { status: 'active' }` thay cho callback, `defineRelations()` thay cho `relations()`); code viết cho 0.x chạy trên 1.0 có thể bỏ qua điều kiện `where` mà không báo lỗi. Kiểm version trước khi chép ví dụ.
- Migration: `drizzle-kit generate` (sinh file SQL, đọc lại) rồi `drizzle-kit migrate`. `drizzle-kit push` chỉ dùng cho prototype.

## 4. TypeORM

```ts
import { MoreThanOrEqual } from 'typeorm';

const customers = await customerRepo.find({
  where: { status: 'active' },
  relations: { orders: true },
  take: 20,
});

await dataSource.transaction(async (manager) => {
  const res = await manager.decrement(Stock, { productId, qty: MoreThanOrEqual(1) }, 'qty', 1);
  if (res.affected === 0) throw new OutOfStockError(productId);
  await manager.save(Order, { customerId, total });
});

await dataSource.query('SELECT id FROM customers WHERE email = $1', [email]);
```

- `synchronize: true` chỉ ở local; production dùng `migration:generate` → đọc → `migration:run`.

## 5. Sequelize

```js
import { Op } from 'sequelize';

const customers = await Customer.findAll({ where: { status: 'active' }, include: [Order], limit: 20 });

await sequelize.transaction(async (t) => {
  const [affected] = await Stock.update(
    { qty: sequelize.literal('qty - 1') },
    { where: { productId, qty: { [Op.gte]: 1 } }, transaction: t },
  );
  if (affected === 0) throw new OutOfStockError(productId);
  await Order.create({ customerId, total }, { transaction: t });
});
```

- Phải truyền `{ transaction: t }` vào **từng** lệnh; quên là lệnh đó chạy ngoài transaction. `sync({ alter: true })` không dùng ở production; dùng migration của sequelize-cli.

## 6. SQLAlchemy 2.x

```python
from sqlalchemy import select, text, update
from sqlalchemy.orm import selectinload

with Session(engine) as session:
    stmt = select(Customer).where(Customer.status == "active").options(selectinload(Customer.orders)).limit(20)
    customers = session.scalars(stmt).all()
    rows = session.execute(text("SELECT id FROM customers WHERE email = :email"), {"email": email}).all()

with Session(engine) as session, session.begin():
    result = session.execute(
        update(Stock).where(Stock.product_id == product_id, Stock.qty >= 1).values(qty=Stock.qty - 1)
    )
    if result.rowcount == 0:
        raise OutOfStockError(product_id)
    session.add(Order(customer_id=customer_id, total=total))
    # commit tự động khi ra khỏi khối, rollback nếu có lỗi
```

- Code có kiểm kiểu bằng mypy: `Session.execute` được khai kiểu `Result` nên `.rowcount` báo lỗi type dù chạy đúng; dùng `cast(CursorResult[Any], session.execute(...))`, hoặc thêm `.returning(Stock.product_id)` rồi kiểm `result.first() is None`.

- `selectinload` cho quan hệ một-nhiều, `joinedload` cho nhiều-một. Có thể đặt `lazy="raise"` trên relationship để lazy load thành lỗi ngay khi dev.
- Migration: Alembic `alembic revision --autogenerate -m "..."` → đọc file → `alembic upgrade head`.

## 7. Django ORM

```python
from django.db import transaction
from django.db.models import F

customers = Customer.objects.filter(status="active").prefetch_related("orders")[:20]
orders = Order.objects.select_related("customer")[:20]   # nhiều-một / một-một: JOIN

with transaction.atomic():
    updated = Stock.objects.filter(product_id=product_id, qty__gte=1).update(qty=F("qty") - 1)
    if updated == 0:
        raise OutOfStockError(product_id)   # ném lỗi trong atomic() = rollback
    Order.objects.create(customer_id=customer_id, total=total)
```

- `select_related` cho FK/one-to-one (JOIN), `prefetch_related` cho reverse FK/many-to-many (query thứ hai).
- Migration: `makemigrations` → `sqlmigrate app 0005` để xem SQL → `migrate`.

## 8. GORM (Go)

```go
var customers []Customer
db.Preload("Orders").Where("status = ?", "active").Limit(20).Find(&customers)

err := db.Transaction(func(tx *gorm.DB) error {
    res := tx.Model(&Stock{}).Where("product_id = ? AND qty >= 1", pid).
        Update("qty", gorm.Expr("qty - 1"))
    if res.Error != nil {
        return res.Error // trả lỗi thì rollback
    }
    if res.RowsAffected == 0 {
        return ErrOutOfStock
    }
    return tx.Create(&Order{CustomerID: cid, Total: total}).Error
})
```

- `AutoMigrate` không xoá cột và không thay được migration có kiểm soát; production dùng công cụ migration riêng (golang-migrate, atlas, goose).

## 9. ActiveRecord (Rails)

```ruby
customers = Customer.where(status: "active").includes(:orders).limit(20)

ActiveRecord::Base.transaction do
  updated = Stock.where(product_id: product_id).where("qty >= 1").update_all("qty = qty - 1")
  raise OutOfStockError if updated.zero?   # ném lỗi = rollback, lỗi đi tiếp ra ngoài
  Order.create!(customer_id: customer_id, total: total)
end
```

- `strict_loading` để biến lazy load thành lỗi khi dev.
- Rails không có lệnh in SQL của migration mà không chạy nó: chạy migration trên DB dev rồi đọc SQL trong `log/development.log`, và dùng `config.active_record.schema_format = :sql` để diff của `db/structure.sql` cho thấy DDL thật. `rails db:migrate:status` chỉ cho biết migration nào đã chạy.
- Đừng dùng `raise ActiveRecord::Rollback` cho lỗi nghiệp vụ: transaction rollback nhưng không có lỗi nào đi ra ngoài, code gọi tưởng là thành công.

## 10. Connection pool và serverless

- Mỗi instance app giữ một pool; tổng số connection = số instance × kích thước pool, phải nhỏ hơn `max_connections` của DB.
- Serverless (Vercel, Lambda, Cloudflare): mỗi lần chạy có thể mở connection mới. Dùng pooler (PgBouncer, pooler của Neon/Supabase, Prisma Accelerate) ở chế độ transaction pooling.
- Transaction pooling không giữ trạng thái phiên giữa các transaction: không dùng `SET` theo session, prepared statement theo session, hay advisory lock theo session. Với multi-tenant, tenant context phải set trong từng transaction (`multi-tenant.md`).
