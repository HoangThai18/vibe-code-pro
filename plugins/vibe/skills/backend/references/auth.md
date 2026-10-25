# Xác thực, phiên và phân quyền

Xác thực (authentication) trả lời "đây là ai"; phân quyền (authorization) trả lời "người này được làm gì, trên dữ liệu nào". Lỗ hổng hay gặp nhất ở app thật nằm ở phần thứ hai: kiểm quyền ở UI mà quên ở API, kiểm quyền theo loại thao tác mà quên kiểm theo từng bản ghi.

Đoạn TypeScript trong file này đã chạy thử (strict, Node 22).

## Mục lục
1. Chọn cách xác thực
2. Phiên đăng nhập
3. Mật khẩu, OTP, quên mật khẩu
4. Phân quyền theo vai trò trong tenant
5. Phân quyền theo từng bản ghi
6. API key cho tích hợp
7. Webhook nhận vào
8. Tài khoản quản trị, đăng nhập thay, audit log
9. Checklist

## 1. Chọn cách xác thực

| Cách | Hợp khi | Lưu ý |
|---|---|---|
| Dịch vụ quản lý sẵn (Clerk, Auth0, Supabase Auth, Firebase Auth, Cognito...) | Muốn nhanh, cần SSO/MFA/đăng nhập mạng xã hội sẵn | Phụ thuộc nhà cung cấp, chi phí theo số người dùng; dữ liệu người dùng nằm ở bên thứ ba |
| Thư viện của framework (Auth.js, Better Auth, Devise, Django auth, Spring Security...) | Muốn giữ dữ liệu người dùng trong DB của mình | Phải tự lo phần vận hành: rate limit, email, khoá tài khoản |
| Tự viết từ đầu | Gần như không bao giờ | Không tự chế cách băm mật khẩu, tạo token, so sánh chữ ký |

Dự án đã có cách xác thực thì theo cách đó. Đọc tài liệu đúng version trước khi dùng (thư viện auth đổi API khá thường xuyên).

## 2. Phiên đăng nhập

- App web: phiên trong **cookie `HttpOnly; Secure; SameSite=Lax`**, không để token trong `localStorage` (script lạ đọc được).
- **Phiên lưu ở server** (bảng sessions hoặc Redis) thu hồi được ngay khi đăng xuất, đổi mật khẩu, khoá tài khoản. **JWT** không thu hồi được trước khi hết hạn: chỉ dùng với thời hạn ngắn (vài phút) kèm refresh token xoay vòng (mỗi lần dùng cấp token mới, token cũ bị vô hiệu; token cũ bị dùng lại thì thu hồi cả chuỗi).
- Đổi session id ngay sau khi đăng nhập (chống session fixation). Đăng xuất thì xoá phiên ở server, không chỉ xoá cookie.
- Request thay đổi dữ liệu dùng cookie: `SameSite=Lax` cộng kiểm header `Origin` khớp domain của app; cần cho phép gọi từ domain khác thì dùng CSRF token.
- Tenant lấy từ path của request và kiểm user là thành viên ở mỗi request; vai trò đọc từ chính membership đó (hoặc cache ngắn), không tin giá trị client gửi (`postgres-rls.md` mục 4). Vai trò nằm trong JWT thì cũ cho tới khi token đổi: thao tác nhạy cảm (đổi quyền, thanh toán, xuất dữ liệu) kiểm lại từ DB.

## 3. Mật khẩu, OTP, quên mật khẩu

- Băm bằng **argon2id** (hoặc bcrypt nếu nền tảng chỉ có bcrypt), tham số theo khuyến nghị hiện hành của OWASP Password Storage Cheat Sheet. Không bao giờ dùng MD5/SHA trần.
- Độ dài tối thiểu 8, cho phép dài (64+), chặn mật khẩu nằm trong danh sách đã lộ; không ép quy tắc "phải có ký tự đặc biệt", không bắt đổi định kỳ (theo NIST SP 800-63B).
- Đăng nhập sai: cùng một thông báo cho "sai email" và "sai mật khẩu"; giới hạn số lần theo tài khoản **và** theo IP, chậm dần thay vì khoá cứng (khoá cứng bị lợi dụng để khoá tài khoản người khác).
- Quên mật khẩu: token ngẫu nhiên dùng một lần, lưu **bản băm** trong DB, hết hạn sau 30–60 phút; trả cùng một thông báo dù email có tồn tại hay không; đặt lại xong thì thu hồi mọi phiên cũ.
- OTP qua SMS/Zalo: 6 số, hết hạn sau vài phút, tối đa ~5 lần nhập sai rồi huỷ mã; giới hạn số lần gửi theo số điện thoại và theo IP, thêm captcha khi vượt ngưỡng. Thiếu giới hạn gửi thì bị lợi dụng gửi tin nhắn hàng loạt, hoá đơn SMS tăng vọt.

## 4. Phân quyền theo vai trò trong tenant

Vai trò gắn với **membership** (`memberships(tenant_id, user_id, role)`), không gắn với user: một người có thể là chủ ở spa này và nhân viên ở spa khác. Quyền gom về **một chỗ**, mặc định từ chối:

```ts
// shared/authz.ts
export type Role = 'owner' | 'manager' | 'staff';
export type Action =
  | 'customer.read' | 'customer.write'
  | 'appointment.write' | 'appointment.confirm'
  | 'billing.manage' | 'member.invite';

const permissions: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>(['customer.read', 'customer.write', 'appointment.write', 'appointment.confirm', 'billing.manage', 'member.invite']),
  manager: new Set<Action>(['customer.read', 'customer.write', 'appointment.write', 'appointment.confirm']),
  staff: new Set<Action>(['customer.read', 'appointment.write']),   // lịch của chính mình: kiểm ở mục 5
};

export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(readonly action: Action) { super(`forbidden: ${action}`); }
}

export function can(role: Role, action: Action): boolean {
  return permissions[role]?.has(action) ?? false;   // vai trò lạ → không có quyền
}

// Gọi ở đầu mỗi use case; tầng HTTP map ForbiddenError → 403
export function authorize(actor: { role: Role }, action: Action): void {
  if (!can(actor.role, action)) throw new ForbiddenError(action);
}
```

- Kiểm quyền ở tầng use case/service, nơi mọi đường vào (HTTP, job, CLI) đều đi qua; không rải `if (user.role === ...)` trong controller và component.
- UI ẩn nút là để tiện, không phải phân quyền: API vẫn phải chặn (test cả hai phía, skill `build`, `e2e-playwright.md` mục 6; từ file này: `../../build/references/e2e-playwright.md`).
- Tài nguyên của tenant khác → **404** (không lộ là có tồn tại). Tài nguyên trong tenant nhưng thiếu quyền → **403**.
- Test dạng bảng cho ma trận vai trò × hành động, để thêm quyền mới chỉ cần thêm dòng:

```ts
import { describe, it, expect } from 'vitest';
import { can, authorize, ForbiddenError, type Role, type Action } from '../src/shared/authz';

describe('ma trận quyền', () => {
  it.each<[Role, Action, boolean]>([
    ['owner', 'billing.manage', true],
    ['manager', 'appointment.confirm', true],
    ['manager', 'billing.manage', false],
    ['staff', 'customer.read', true],
    ['staff', 'customer.write', false],
    ['staff', 'appointment.write', true],
    ['staff', 'appointment.confirm', false],
  ])('%s %s → %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('vai trò không có trong bảng thì bị từ chối', () => {
    expect(() => authorize({ role: 'intern' as Role }, 'customer.read')).toThrow(ForbiddenError);
  });
});
```

## 5. Phân quyền theo từng bản ghi

Có quyền `appointment.write` chưa có nghĩa là sửa được **mọi** lịch hẹn. Quy tắc kiểu "nhân viên chỉ sửa lịch của chính mình" kiểm trên bản ghi cụ thể, sau khi đã tải nó trong phạm vi tenant:

```ts
// trong use case updateAppointment, sau khi tải appt bằng repository có tenant context
if (actor.role === 'staff' && appt.staffId !== actor.userId) throw new ForbiddenError('appointment.write');
```

- **IDOR**: mọi id đến từ client (path, body, query) là đầu vào không tin được. Tải bản ghi qua phạm vi tenant (RLS hoặc repository có tenant), rồi kiểm quyền trên bản ghi đó.
- **Mass assignment**: schema validate liệt kê đúng các field được sửa. `role`, `tenantId`, `ownerId`, `status`, giá tiền không bao giờ lấy thẳng từ body.
- Đổi vai trò: người đổi phải có quyền cao hơn hoặc bằng vai trò được gán; tenant luôn còn ít nhất một owner.

## 6. API key cho tích hợp

- Sinh ngẫu nhiên ít nhất 32 byte, có tiền tố để nhận ra loại và môi trường (vd `vk_live_...`); chỉ hiện **một lần** lúc tạo.
- DB lưu bản băm (SHA-256 là đủ vì key ngẫu nhiên dài), kèm `tenant_id`, phạm vi quyền (scope), `expires_at`, `last_used_at`, `revoked_at`.
- Key gắn với tenant và scope tối thiểu; cho phép nhiều key song song để xoay vòng không downtime.

## 7. Webhook nhận vào

Cổng thanh toán, Zalo OA, dịch vụ email gọi vào hệ thống: ai cũng gửi được request tới URL đó, nên phải kiểm chữ ký.

- Dùng hàm kiểm chữ ký trong SDK chính thức của nhà cung cấp nếu có; mỗi bên một định dạng chữ ký, đọc đúng tài liệu của họ.
- Tự kiểm thì: HMAC trên **raw body** (chưa qua JSON parse), so sánh bằng hàm an toàn thời gian, từ chối request quá cũ để chặn gửi lại:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Ví dụ cho định dạng header "t=<unix giây>,v1=<hex HMAC-SHA256 của `${t}.${rawBody}`>[,v1=...]"
export function verifyWebhook(rawBody: Buffer, header: string, secret: string, nowMs = Date.now()): boolean {
  const pairs = header.split(',').map((kv) => kv.trim().split('=', 2));
  const t = Number(pairs.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300) return false;   // lệch quá 5 phút
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  // Lúc nhà cung cấp xoay vòng secret, header có nhiều chữ ký v1: hợp lệ nếu một chữ ký khớp
  return pairs.some(([k, v]) => {
    if (k !== 'v1' || !v) return false;
    const given = Buffer.from(v, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

- Xử lý idempotent theo id sự kiện (bảng `processed_events` có UNIQUE): nhà cung cấp gửi lại nhiều lần là chuyện bình thường.
- Trả 2xx nhanh, việc nặng đẩy sang hàng đợi hoặc outbox. Không tin số tiền, trạng thái trong payload khi có thể hỏi lại API của nhà cung cấp.

## 8. Tài khoản quản trị, đăng nhập thay, audit log

- Bật MFA cho owner và mọi tài khoản quản trị nội bộ.
- Trang quản trị nội bộ tách khỏi app khách (route, quyền, tốt nhất là domain riêng), mọi thao tác ghi audit log.
- Đăng nhập thay khách (hỗ trợ khách hàng): cần lý do, giới hạn thời gian, banner rõ ràng trên màn hình, ghi audit log cả người thật lẫn tài khoản bị đăng nhập thay; không làm được thao tác nhạy cảm (đổi mật khẩu, thanh toán).
- Audit log: ai, làm gì, trên tenant nào, lúc nào, từ đâu (IP, user agent), trước và sau (với thay đổi quyền, giá). Chỉ ghi thêm, không sửa; giữ theo chính sách lưu trữ.

## 9. Checklist

- [ ] Phiên trong cookie `HttpOnly; Secure; SameSite`; đăng xuất thu hồi phiên ở server
- [ ] Mật khẩu băm bằng argon2id/bcrypt; đăng nhập sai và gửi OTP có giới hạn theo tài khoản và IP
- [ ] Mọi endpoint kiểm quyền ở server qua một hàm chung; mặc định từ chối
- [ ] Bản ghi tải trong phạm vi tenant rồi mới kiểm quyền theo bản ghi; tenant khác → 404, thiếu quyền → 403
- [ ] Schema validate chặn mass assignment (`role`, `tenantId`, `ownerId`...)
- [ ] Test ma trận vai trò × hành động, và test API cho vai trò bị từ chối
- [ ] Webhook kiểm chữ ký trên raw body, chặn request cũ, xử lý idempotent
- [ ] MFA và audit log cho quản trị; đăng nhập thay có giới hạn và được ghi lại
