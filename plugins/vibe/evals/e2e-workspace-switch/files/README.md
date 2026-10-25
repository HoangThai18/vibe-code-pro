# spa-crm-demo

App demo: `node server.mjs` (cổng 3100, đổi bằng biến PORT).

Tài khoản test (mật khẩu đều là `pass`):
- `multi@example.test`: thành viên của cả `spa-a` (Spa Hoa Mai) và `spa-b` (Spa Bạch Dương)
- `owner-a@example.test`, `staff-a@example.test`: chỉ thuộc `spa-a`
- `owner-b@example.test`: chỉ thuộc `spa-b`

API: `POST /api/login {email, password}` (đặt cookie phiên), `GET /t/<tenant>/api/customers`.
Màn hình: `/login`, `/t/<tenant>/customers` (ô chọn "Workspace" ở header đổi tenant).
Dữ liệu mẫu: Spa Hoa Mai có khách "Nguyễn Thị A1", Spa Bạch Dương có khách "Trần Văn B1".
