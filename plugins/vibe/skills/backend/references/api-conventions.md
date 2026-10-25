# Quy ước API mặc định

Điểm xuất phát khi dự án chưa có quy ước. Dự án đã có quy ước thì theo dự án. Chốt xong ghi tóm tắt vào `CLAUDE.md`.

## Mục lục
1. Đặt tên và cấu trúc
2. Response và lỗi
3. Phân trang, lọc, sắp xếp
4. Kiểu dữ liệu
5. Auth và tenant
6. Idempotency
7. Mẫu contract: zod, OpenAPI, MSW

## 1. Đặt tên và cấu trúc
- REST theo resource, danh từ số nhiều. Tài nguyên thuộc tenant nằm dưới tiền tố `/v1/t/{tenantId}` (mục 5): `GET /v1/t/{tenantId}/customers`, `GET .../customers/{id}`, `POST .../customers`, `PATCH .../customers/{id}`, `DELETE .../customers/{id}`.
- Hành động không phải CRUD: `POST .../orders/{id}/cancel`, `POST .../customers/{id}/archive`.
- Field JSON: camelCase (hoặc snake_case, chọn một và dùng toàn hệ thống).
- Version ở tiền tố path (`/v1`); chỉ tăng version khi có breaking change.

## 2. Response và lỗi
- Một tài nguyên: `{ "data": { ... } }`
- Danh sách: `{ "data": [ ... ], "nextCursor": "..." }` (`nextCursor` là `null` ở trang cuối)
- Lỗi:

```json
{
  "error": {
    "code": "customer_email_taken",
    "message": "Email này đã có trong workspace.",
    "details": { "field": "email" },
    "requestId": "req_01J9Z..."
  }
}
```

| HTTP | Khi nào |
|---|---|
| 400 | Sai format / validate fail (`details` liệt kê lỗi theo field) |
| 401 | Chưa đăng nhập, token hết hạn |
| 403 | Đã đăng nhập nhưng không có quyền làm hành động này |
| 404 | Không tồn tại **hoặc thuộc tenant khác** (không phân biệt hai trường hợp) |
| 409 | Xung đột: trùng giá trị unique, version cũ |
| 422 | Đúng format nhưng vi phạm quy tắc nghiệp vụ |
| 429 | Vượt rate limit (kèm `Retry-After`) |
| 500 | Lỗi server: message chung, chi tiết chỉ nằm trong log (tra theo `requestId`) |

## 3. Phân trang, lọc, sắp xếp
- Danh sách có thể dài dùng cursor: `?limit=20&cursor=...` (mặc định 20, tối đa 100). Offset chỉ dùng cho bảng nhỏ cần nhảy trang.
- Cursor là chuỗi mờ (vd base64 của `createdAt,id`); sort ổn định, có `id` làm tie-breaker.
- Lọc: `?status=active&createdFrom=2026-01-01T00:00:00Z`. Sắp xếp: `?sort=-createdAt`, chỉ nhận field trong danh sách cho phép.

## 4. Kiểu dữ liệu
- ID: string (UUID/ULID).
- Thời gian: ISO 8601 UTC (`2026-10-24T08:30:00Z`); FE hiển thị theo timezone người dùng hoặc của tenant.
- Tiền: số nguyên theo đơn vị nhỏ nhất + mã tiền tệ: `{ "amount": 150000, "currency": "VND" }`. Không dùng float.
- Enum: string có nghĩa (`"active"`), không dùng số.
- PATCH: không gửi field nghĩa là giữ nguyên; gửi `null` nghĩa là xoá giá trị. Ghi rõ field nào được phép `null`.

## 5. Auth và tenant
- Token hoặc session cookie → server xác định **user**.
- Tenant nằm trong **path** (`/v1/t/{tenantId}/...`). Ở **mỗi** request, server kiểm user là thành viên của tenant đó, lấy role từ membership, rồi set tenant context cho transaction (skill backend, `postgres-rls.md` mục 4). Không phải thành viên, hoặc `tenantId` sai định dạng → 404.
- Không có "tenant hiện tại" ngầm trong phiên: đổi workspace ở FE chỉ là đổi URL, mở nhiều tab với workspace khác nhau vẫn đúng (skill frontend, `state-management.md` mục 5). Phiên chỉ nên nhớ workspace dùng gần nhất để chuyển hướng sau đăng nhập.
- `tenantId` trong body/query bị bỏ qua: tenant chỉ lấy từ path đã kiểm membership.
- Mỗi endpoint ghi quyền yêu cầu (vd `customers:write`).

## 6. Idempotency
POST tạo tài nguyên có side effect nhận `Idempotency-Key`. Server lưu key + kết quả (theo tenant) khoảng 24h; request trùng key trả lại kết quả cũ thay vì làm lại.

## 7. Mẫu contract

### zod (TypeScript, package dùng chung)

```ts
// packages/contracts/src/customers.ts
import { z } from 'zod';

export const Customer = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email().nullable(),
  phone: z.string().max(20).nullable(),
  status: z.enum(['active', 'archived']),
  createdAt: z.string().datetime(),
});
export type Customer = z.infer<typeof Customer>;

// Input tạo mới: email/phone không bắt buộc. Lưu ý .nullable() KHÔNG làm field thành optional,
// nên phải thêm .optional() thì client mới được bỏ trống field.
export const CreateCustomerInput = z.object({
  name: Customer.shape.name,
  email: Customer.shape.email.optional(),
  phone: Customer.shape.phone.optional(),
});
export const UpdateCustomerInput = CreateCustomerInput.partial();

export const ListCustomersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const ListCustomersResponse = z.object({
  data: z.array(Customer),
  nextCursor: z.string().nullable(),
});
```

(zod v4 vẫn chạy cách viết trên; có thể viết gọn `z.uuid()`, `z.email()`, `z.iso.datetime()`.)

### OpenAPI 3.1 (rút gọn)

```yaml
openapi: 3.1.0
info: { title: Mini CRM API, version: 1.0.0 }
paths:
  /v1/t/{tenantId}/customers:
    get:
      summary: Danh sách khách hàng của workspace
      parameters:
        - { name: tenantId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
        - { name: cursor, in: query, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/CustomerList' }
        '401': { $ref: '#/components/responses/Error' }
components:
  schemas:
    Customer:
      type: object
      required: [id, name, status, createdAt]
      properties:
        id: { type: string, format: uuid }
        name: { type: string, maxLength: 200 }
        email: { type: [string, 'null'], format: email }
        status: { type: string, enum: [active, archived] }
        createdAt: { type: string, format: date-time }
    CustomerList:
      type: object
      required: [data, nextCursor]
      properties:
        data: { type: array, items: { $ref: '#/components/schemas/Customer' } }
        nextCursor: { type: [string, 'null'] }
    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message]
          properties:
            code: { type: string }
            message: { type: string }
            details: { type: object }
            requestId: { type: string }
  responses:
    Error:
      description: Lỗi
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
```

### Mock cho FE (MSW v2)

```ts
// apps/web/src/mocks/customers.ts
import { http, HttpResponse } from 'msw';
import { customersFixture } from './fixtures/customers';

export const customerHandlers = [
  http.get('/v1/t/:tenantId/customers', () =>
    HttpResponse.json({ data: customersFixture, nextCursor: null })),
  http.post('/v1/t/:tenantId/customers', async ({ request }) => {
    const body = (await request.json()) as { email?: string | null };
    if (body.email === 'taken@example.com') {
      return HttpResponse.json(
        { error: { code: 'customer_email_taken', message: 'Email này đã có trong workspace.', details: { field: 'email' } } },
        { status: 409 },
      );
    }
    return HttpResponse.json({ data: { ...customersFixture[0], ...body } }, { status: 201 });
  }),
];
```
