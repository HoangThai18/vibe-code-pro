# PRD: Tên sản phẩm

_Phiên bản v0.1 · YYYY-MM-DD · Trạng thái: nháp / đã duyệt_

## 1. Vấn đề
Ai đang gặp vấn đề gì, hiện họ giải quyết thế nào, vì sao cách đó chưa ổn. 3–5 câu.

## 2. Người dùng và vai trò
| Vai trò | Họ là ai | Việc chính trong hệ thống |
|---|---|---|
| Chủ cửa hàng | ... | ... |
| Nhân viên | ... | ... |

## 3. Mục tiêu của bản này
- Kết quả đo được, vd "Nhân viên tạo lịch hẹn cho khách trong dưới 30 giây"
- ...

## 4. Luồng chính
1. Là **vai trò**, tôi muốn **hành động** để **lợi ích**.
   - Tiêu chí chấp nhận: ...
2. ...

## 5. Phạm vi
**Trong phạm vi:**
- ...

**Ngoài phạm vi (không làm ở bản này):**
- ...

## 6. Yêu cầu phi chức năng
- Multi-tenant: có / không. Mô hình: ... (xem ARCHITECTURE.md)
- Bảo mật và dữ liệu: dữ liệu cá nhân nào (có dữ liệu nhạy cảm: sức khoẻ, vị trí, tài chính, trẻ em?), ai được xem, lưu bao lâu, gửi cho dịch vụ nào ở nước ngoài
- Quy mô: số tenant, user, bản ghi dự kiến sau 12 tháng
- Hiệu năng: p95 theo nhóm endpoint ở mức tải mục tiêu (vd danh sách dưới 300 ms ở 100 request/giây); Core Web Vitals mức tốt (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1)
- Tính năng AI (nếu có): việc gì, người dùng sửa được kết quả không, chi phí ước tính mỗi tháng, ngân sách theo tenant
- Nền tảng: web / app iOS, Android / app Windows, macOS, Linux; phiên bản hệ điều hành tối thiểu
- Ngôn ngữ, thiết bị, trình duyệt: ...
- Offline: không cần / chỉ xem / ghi khi offline (app mobile, desktop)

## 7. Tích hợp
| Hệ thống | Mục đích | Bắt buộc ở bản này? |
|---|---|---|

## 8. Giả định và câu hỏi mở
**Giả định** (user sửa nếu sai):
- ...

**Câu hỏi mở:**
- ...
