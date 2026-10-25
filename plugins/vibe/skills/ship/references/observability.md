# Giám sát: log, metric, trace, cảnh báo

Mục tiêu: biết hệ thống có ổn không trước khi người dùng báo, và khi có lỗi thì tìm ra nguyên nhân trong vài phút chứ không phải vài giờ.

## Mục lục
1. Log có cấu trúc
2. Error tracking
3. Metric
4. Trace
5. Healthcheck
6. Cảnh báo
7. Dashboard
8. Multi-tenant

## 1. Log có cấu trúc

- Log dạng JSON, mỗi dòng có: `time`, `level`, `msg`, `requestId`, `tenantId`, `userId` (id, không phải email), `route`, `durationMs`, `status`.
- `requestId` sinh ở biên (hoặc lấy từ header của load balancer), truyền qua mọi lời gọi nội bộ và job, trả về client trong format lỗi để người dùng báo lỗi kèm mã đó.
- Không log mật khẩu, token, số thẻ, nội dung nhạy cảm, payload đầy đủ của form cá nhân. Dùng danh sách trường bị che (redact) ở logger.
- Mức log: `error` khi cần người xử lý; `warn` cho bất thường tự phục hồi được; `info` cho sự kiện nghiệp vụ quan trọng; `debug` tắt ở production.

## 2. Error tracking

- Dùng Sentry hoặc công cụ tương đương cho cả BE và FE: gom lỗi theo loại, có stack trace, release version, gắn `tenantId`, `requestId`.
- Upload source map khi build FE (không phục vụ source map công khai nếu không muốn lộ code).
- Mỗi lỗi mới sau release được xem trong ngày; lỗi lặp lại thành task card.

## 3. Metric

- **RED** cho mỗi endpoint và job: Rate (số request), Errors (tỉ lệ lỗi 5xx và lỗi nghiệp vụ quan trọng), Duration (p50, p95, p99).
- **USE** cho tài nguyên: CPU, RAM, connection DB đang dùng/tối đa, độ dài hàng đợi job, dung lượng đĩa.
- Metric nghiệp vụ: số đơn, số lịch hẹn, tỉ lệ thanh toán thành công. Chúng thường báo sự cố sớm hơn metric kỹ thuật.
- Đặt mục tiêu (SLO) cho vài luồng chính, vd "99,5% request tạo lịch hẹn thành công và dưới 1 giây trong 30 ngày".

## 4. Trace

Hệ thống có nhiều service, hàng đợi hoặc nhiều lời gọi ra ngoài thì thêm tracing (OpenTelemetry) để xem một request đi qua đâu, chậm ở bước nào. Monolith nhỏ thì log có `requestId` và `durationMs` thường là đủ lúc đầu.

## 5. Healthcheck

- **Liveness** (`/health/live`): tiến trình còn sống; không kiểm phụ thuộc bên ngoài, nếu không DB chập chờn sẽ làm nền tảng khởi động lại toàn bộ app.
- **Readiness** (`/health/ready`): sẵn sàng nhận traffic: kết nối được DB, migration đã đúng version. Dùng cho deploy không downtime.
- Không trả thông tin nội bộ (version thư viện, chuỗi kết nối) ra endpoint công khai.

## 6. Cảnh báo

- Cảnh báo theo **triệu chứng**: tỉ lệ lỗi tăng, p95 vượt ngưỡng, hàng đợi job dồn, thanh toán thất bại, backup thất bại, đĩa sắp đầy, chứng chỉ SSL sắp hết hạn.
- Mỗi cảnh báo kèm link runbook: ý nghĩa, cách kiểm tra, cách xử lý tạm thời.
- Mức độ: khẩn (gọi người trực ngay) và không khẩn (xử lý trong giờ làm). Cảnh báo kêu mà không ai cần làm gì thì sửa ngưỡng hoặc xoá, nếu không team sẽ quen bỏ qua cảnh báo.
- Uptime check từ bên ngoài cho trang chủ và API chính.

## 7. Dashboard

Một dashboard tổng quan cho mỗi môi trường: RED của các luồng chính, lỗi theo release, tài nguyên DB, hàng đợi job, metric nghiệp vụ. Đánh dấu thời điểm deploy trên biểu đồ để thấy ngay deploy nào gây ra thay đổi.

## 8. Multi-tenant

- Mọi log, lỗi, metric có `tenantId` để biết sự cố ảnh hưởng ai và báo đúng khách.
- Theo dõi tenant "ồn" (noisy neighbor): request, thời gian query, dung lượng theo tenant; kết hợp rate limit và quota.
- Không đưa dữ liệu của tenant vào nhãn metric có số lượng giá trị lớn (vd id bản ghi); `tenantId` thì được nếu số tenant vừa phải, nhiều tenant thì đưa vào log thay vì nhãn metric.
