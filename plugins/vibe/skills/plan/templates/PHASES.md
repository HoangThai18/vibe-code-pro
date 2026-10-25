# Phases: Tên sản phẩm

| Phase | Mục tiêu | Trạng thái |
|---|---|---|
| P0 | Nền móng chạy được trên staging | todo |
| P1 | Luồng người dùng 1 | todo |
| P2 | Luồng người dùng 2 | todo |

---

## P0: Nền móng
**Mục tiêu:** repo, CI, auth, tenancy, layout app, deploy staging. Mọi phase sau đứng trên nền này.

**Phạm vi:**
- Monorepo / cấu trúc thư mục, lint, typecheck, test, CI trên mỗi PR
- Auth + chọn workspace (tenant), schema lõi (tenants, users, memberships) + RLS
- Layout app (khung điều hướng), design token cơ bản
- Deploy tự động lên staging

**Exit criteria (kiểm chứng được):**
- [ ] CI chạy lint + typecheck + test và chặn PR khi fail
- [ ] Đăng nhập, tạo/chọn workspace; dữ liệu cô lập theo tenant (có test)
- [ ] Staging tự deploy từ main, có healthcheck

**Cần design:** khung layout, màn đăng nhập (Claude Design)

**Rủi ro:** ...

---

## P1: Tên luồng người dùng
**Mục tiêu:** một câu, nói theo góc nhìn người dùng.

**Phạm vi:**
- ...

**Exit criteria:**
- [ ] Demo được luồng X trên staging bằng dữ liệu thật
- [ ] Test cô lập tenant cho mọi endpoint mới
- [ ] ...

**Cần design:** màn ...

**Rủi ro:** ...
