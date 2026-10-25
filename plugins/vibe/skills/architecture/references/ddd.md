# DDD có chừng mực

Domain-Driven Design đáng dùng khi phần khó nhất của phần mềm là **nghiệp vụ**, không phải kỹ thuật. Với CRUD đơn giản, DDD đầy đủ chỉ thêm lớp lang. Cách thực tế: luôn dùng phần chiến lược (ngôn ngữ chung, ranh giới), và chỉ dùng phần chiến thuật (aggregate, value object...) cho miền lõi phức tạp.

## Mục lục
1. Khi nào đáng
2. Chiến lược: ngôn ngữ chung, miền con, bounded context
3. Chiến thuật: value object, entity, aggregate, domain service, repository, domain event
4. Ví dụ: lịch hẹn spa
5. Sai lầm hay gặp
6. DDD-lite cho dự án vibe

## 1. Khi nào đáng

Đáng khi có ít nhất vài dấu hiệu: nhiều quy tắc nghiệp vụ đan nhau, trạng thái và chuyển trạng thái quan trọng (đặt chỗ, duyệt, thanh toán), cùng một từ mang nghĩa khác nhau ở các bộ phận, quy tắc thay đổi thường xuyên theo yêu cầu kinh doanh, sai một quy tắc là mất tiền hoặc mất khách.

## 2. Chiến lược

- **Ngôn ngữ chung (ubiquitous language)**: bảng thuật ngữ trong `DOMAIN.md`, dùng y hệt trong code, DB, API, UI. Đổi thuật ngữ thì đổi ở mọi nơi.
- **Miền con**: *lõi* (tạo lợi thế, vd thuật toán xếp lịch), *hỗ trợ* (cần nhưng không khác biệt, vd quản lý nhân viên), *chung* (ai cũng có, vd đăng nhập, gửi email: dùng giải pháp có sẵn). Đầu tư thiết kế vào miền lõi.
- **Bounded context**: phạm vi mà một mô hình và thuật ngữ có nghĩa nhất quán. "Khách hàng" ở bán hàng (người mua, công nợ) khác "khách hàng" ở chăm sóc (lịch sử khiếu nại). Mỗi context là một module (hoặc sau này một service), có mô hình riêng, giao tiếp qua interface hoặc event.

## 3. Chiến thuật

- **Value object**: giá trị không có danh tính, bất biến, tự kiểm hợp lệ khi tạo: `Money`, `PhoneNumber`, `DateRange`, `Email`. Thay cho kiểu nguyên thuỷ để không bao giờ cộng tiền VND với USD hay lưu số điện thoại sai định dạng.
- **Entity**: có danh tính và vòng đời (`Customer`, `Appointment`).
- **Aggregate**: cụm entity và value object được giữ nhất quán cùng nhau, có một **gốc** là cửa duy nhất để thay đổi. Mặc định: một transaction sửa một aggregate; aggregate khác tham chiếu bằng id; bất biến (invariant) được kiểm trong gốc; lưu kèm cột `version` để hai người sửa cùng lúc không đè nhau (optimistic locking). Đây là mặc định hợp lý, không phải luật: thao tác nghiệp vụ cần đổi hai aggregate cùng lúc thì vẫn dùng chung transaction.
- **Bất biến giữa nhiều aggregate phải được DB bảo đảm**: kiểu "kiểm trước rồi insert" ở code sẽ lọt khi có hai request đồng thời. Ví dụ "một nhân viên không có hai lịch hẹn chồng giờ":
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE appointments ADD CONSTRAINT no_staff_overlap
    EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status IN ('pending', 'confirmed'));
  ```
  Không dùng được constraint thì khoá theo nhân viên trong transaction (`SELECT ... FOR UPDATE` trên dòng nhân viên, hoặc advisory lock theo `staff_id`). Domain service chỉ để báo lỗi thân thiện trước; constraint mới là thứ chặn thật.
- **Domain service**: quy tắc liên quan nhiều aggregate mà không thuộc về riêng cái nào (vd tính giá theo gói, kiểm lịch trống để gợi ý giờ).
- **Repository**: một repository cho mỗi aggregate gốc, nhận và trả aggregate hoàn chỉnh; không làm repository chung chung cho mọi bảng.
- **Domain event**: sự kiện nghiệp vụ đã xảy ra (`AppointmentConfirmed`), phát sau khi trạng thái đổi; module khác phản ứng (gửi tin nhắn, ghi doanh thu) qua outbox để không mất sự kiện.
- **Application service / use case**: điều phối một tình huống sử dụng: tải aggregate, gọi hành vi, lưu, phát event, quản lý transaction. Không chứa quy tắc nghiệp vụ.

## 4. Ví dụ: lịch hẹn spa

```ts
// domain/errors.ts: lỗi nghiệp vụ có code, tầng HTTP map sang 409/422 (không thành 500)
export class DomainError extends Error {
  constructor(readonly code: string) { super(code); }
}

// domain/money.ts: value object bất biến, tự kiểm hợp lệ
export class Money {
  private constructor(readonly amount: number, readonly currency: 'VND' | 'USD') {}
  static of(amount: number, currency: 'VND' | 'USD'): Money {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new DomainError('invalid_amount');
    return new Money(amount, currency);
  }
  static vnd(amount: number): Money { return Money.of(amount, 'VND'); }
  add(other: Money): Money {
    if (other.currency !== this.currency) throw new DomainError('currency_mismatch');
    return Money.of(this.amount + other.amount, this.currency);
  }
  equals(other: Money): boolean { return this.amount === other.amount && this.currency === other.currency; }
}

// domain/appointment.ts: aggregate root giữ quy tắc chuyển trạng thái (BR-xx trong DOMAIN.md)
export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type AppointmentSnapshot = {
  id: string; tenantId: string; staffId: string; status: AppointmentStatus;
  startsAt: Date; endsAt: Date; depositAmount: number; version: number;
};

export type AppointmentEvent =
  | { type: 'AppointmentConfirmed'; tenantId: string; appointmentId: string; deposit: number; occurredAt: Date }
  | { type: 'AppointmentCancelled'; tenantId: string; appointmentId: string; refund: number; occurredAt: Date };

export class Appointment {
  private events: AppointmentEvent[] = [];
  private constructor(private state: AppointmentSnapshot) {}

  // Tạo mới: kiểm bất biến ban đầu
  static create(input: { id: string; tenantId: string; staffId: string; startsAt: Date; endsAt: Date }): Appointment {
    if (input.endsAt <= input.startsAt) throw new DomainError('invalid_time_range');
    return new Appointment({ ...input, status: 'pending', depositAmount: 0, version: 0 });
  }
  // Dựng lại từ DB (repository dùng), không kiểm lại như lúc tạo
  static rehydrate(snapshot: AppointmentSnapshot): Appointment { return new Appointment({ ...snapshot }); }
  snapshot(): AppointmentSnapshot { return { ...this.state }; }

  assertCanConfirm(): void {
    if (this.state.status !== 'pending') throw new DomainError('appointment_not_pending');
  }

  confirm(deposit: Money, now: Date): void {
    this.assertCanConfirm();
    this.state = { ...this.state, status: 'confirmed', depositAmount: deposit.amount };
    this.events.push({ type: 'AppointmentConfirmed', tenantId: this.state.tenantId, appointmentId: this.state.id, deposit: deposit.amount, occurredAt: now });
  }

  cancel(now: Date): void {
    const { status, startsAt, depositAmount } = this.state;
    if (status !== 'pending' && status !== 'confirmed') throw new DomainError('appointment_not_cancellable');
    const hoursLeft = (startsAt.getTime() - now.getTime()) / 3_600_000;
    const refund = status === 'confirmed' && hoursLeft >= 24 ? depositAmount : 0; // BR-07: huỷ trước 24h được hoàn cọc
    this.state = { ...this.state, status: 'cancelled' };
    this.events.push({ type: 'AppointmentCancelled', tenantId: this.state.tenantId, appointmentId: this.state.id, refund, occurredAt: now });
  }

  pullEvents(): AppointmentEvent[] { const e = this.events; this.events = []; return e; }
}
```

Use case `cancelAppointment`: trong một transaction có tenant context, tải aggregate qua repository, gọi `cancel(now)`, lưu bằng `UPDATE ... WHERE id = $1 AND version = $2` (0 dòng bị ảnh hưởng thì báo xung đột), và ghi các event vào bảng outbox **trong cùng transaction**. Việc hoàn tiền thật qua cổng thanh toán do worker đọc outbox thực hiện sau khi commit, kèm idempotency key, vì gọi dịch vụ ngoài bên trong transaction DB là sai (backend, `data-layer.md` mục 6). Quy tắc "huỷ trước 24h được hoàn cọc" nằm đúng một chỗ, test bằng unit test không cần DB.

## 5. Sai lầm hay gặp

- Áp DDD đầy đủ cho mọi module, kể cả CRUD: nhiều lớp mà không thêm giá trị.
- Aggregate quá lớn (cả "Customer" ôm mọi đơn hàng, lịch hẹn): khoá nhiều, chậm. Chia nhỏ theo ranh giới nhất quán thật sự.
- Quy tắc nghiệp vụ nằm trong controller hoặc câu SQL, còn entity chỉ là túi dữ liệu, trong khi miền đó phức tạp.
- Dùng thẳng model của ORM làm domain object rồi để framework điều khiển thiết kế. Ở dự án TypeScript dùng Prisma/Drizzle, cách thực tế thường là: type thuần + hàm domain thuần (hoặc class như trên) + repository chuyển đổi giữa hai bên.

## 6. DDD-lite cho dự án vibe

Đủ dùng cho phần lớn dự án:

1. Bảng thuật ngữ + quy tắc `BR-xx` + state machine trong `DOMAIN.md`.
2. Module theo bounded context.
3. Value object cho tiền, thời gian, số điện thoại, email.
4. Chuyển trạng thái nằm trong một hàm hoặc class của miền, có unit test cho từng chuyển đổi hợp lệ và không hợp lệ.
5. Domain event qua outbox cho tác động phụ.

Chỉ thêm aggregate, domain service, repository theo aggregate cho miền lõi khi những bước trên không còn đủ.
