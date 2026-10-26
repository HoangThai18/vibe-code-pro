# Checklist review

Dùng để gợi nhớ, không phải để điền cho đủ. Chỉ báo vấn đề thực sự có trong diff, kèm `file:dòng`, kịch bản gây lỗi (đầu vào hoặc trạng thái → hậu quả) và cách sửa ngắn.

## Đúng yêu cầu
- Làm đúng acceptance criteria; không làm lan ra ngoài phạm vi task.
- Edge case: rỗng, null, trùng, giới hạn, ký tự tiếng Việt và emoji, múi giờ, số âm hoặc bằng 0, danh sách rất dài.

## Thiết kế và nhất quán với codebase
- Theo quy ước đang có (cấu trúc file, đặt tên, báo lỗi, validate, test) của module tương tự; không thêm cách thứ hai để làm cùng một việc.
- Logic nghiệp vụ ở tầng nghiệp vụ, không rải trong controller, component hay SQL; không import ngược chiều hay vòng tròn; không đọc thẳng bảng của module khác.
- Không chép lại logic hoặc helper đã có; không thêm dependency mới khi không cần.
- Không trừu tượng hoá sớm (interface, factory, generic cho thứ chỉ có một cách dùng), cũng không để một hàm hay service ôm nhiều việc.

## Bảo mật
- Endpoint mới có xác thực; phân quyền kiểm trên chính tài nguyên được truy cập, không chỉ kiểm "đã đăng nhập".
- IDOR: truy cập theo id có kiểm tài nguyên thuộc tenant/user hiện tại.
- Mass assignment: không bind thẳng body vào model (`role`, `tenantId`, `ownerId`, `price`, `status`...).
- Input validate ở biên bằng schema; query tham số hoá, không nối chuỗi SQL; không eval/exec dữ liệu người dùng.
- Không có secret trong code, log hay response; không trả stack trace ra client.
- Upload: kiểm loại và kích thước; tên file lưu không do người dùng quyết định; không phục vụ file upload như HTML cùng domain.
- Webhook: xác minh chữ ký. Server fetch URL do người dùng đưa: chống SSRF. Redirect theo tham số: chống open redirect.

## Cô lập tenant
- Mọi truy vấn bảng tenant chạy trong context tenant (lớp repository / RLS); không nhận `tenantId` từ client.
- Bảng mới: `tenant_id NOT NULL`, composite FK, unique và index có `tenant_id`, RLS + `FORCE` + policy trong cùng migration.
- Policy `FOR ALL` không có nhánh `OR` (nhánh `OR` mở cả quyền sửa/xoá); cần đọc rộng hơn thì có policy `FOR SELECT` riêng.
- Job, cache key, đường dẫn storage, search index mới đều mang `tenant_id`.
- Có test cô lập tenant cho endpoint mới, chạy bằng role app.

## Dữ liệu và migration
- Migration chạy được trên DB đã có dữ liệu; có `lock_timeout`; không khoá bảng lớn lâu (`CREATE INDEX CONCURRENTLY`, `NOT VALID` rồi `VALIDATE`); có đường lùi.
- Backfill trên bảng có `FORCE` chạy bằng role maintenance (BYPASSRLS) hoặc theo từng tenant, có kiểm số dòng bị ảnh hưởng; bước xoá cột cũ chỉ chạy sau khi đã kiểm.
- Bất biến quan trọng được giữ bằng ràng buộc ở DB (NOT NULL, FK, UNIQUE, CHECK), không chỉ ở code.
- Ghi nhiều bảng thì dùng transaction. Side effect ra ngoài (mail, thanh toán, webhook) không chạy giữa transaction DB và có idempotency.
- Tiền là số nguyên + mã tiền tệ; thời gian lưu UTC.

## Xử lý lỗi và khả năng quan sát
- Không nuốt lỗi (catch rỗng, log rồi bỏ qua); lỗi trả về có `code` rõ ràng cho FE.
- Log có `requestId` và `tenantId`, không log dữ liệu cá nhân hay secret.
- Gọi bên thứ ba có timeout; retry có giới hạn và backoff.

## Hiệu năng
- Không N+1 (query trong vòng lặp); danh sách có phân trang và `limit` tối đa.
- Filter/sort mới có index phù hợp (bắt đầu bằng `tenant_id`).
- Không tải cả bảng vào bộ nhớ; không gọi API ngoài trong vòng lặp nếu có endpoint batch.

## Frontend
- Khớp design: token, spacing, đủ các state (loading / empty / error / disabled).
- Bàn phím và focus, label cho input, tương phản đạt AA, có `prefers-reduced-motion`.
- Không lộ secret trong bundle client; không lưu token hay dữ liệu nhạy cảm vào localStorage nếu dự án có phương án an toàn hơn (cookie httpOnly).
- Lỗi từ API hiển thị đúng chỗ (theo field) và bằng ngôn ngữ người dùng hiểu.

## App mobile và desktop
- Token trong Keychain/Keystore hoặc `safeStorage`, không trong AsyncStorage, localStorage, file text; không có secret của server trong app.
- Thay đổi API tương thích với các bản app còn hỗ trợ (skill `backend`, `api-conventions.md` mục 8); app gửi header phiên bản.
- Đăng xuất xoá token, cache, dữ liệu cục bộ, hủy đăng ký push của thiết bị.
- Electron: `contextIsolation`, `sandbox` bật; preload chỉ expose hàm cụ thể; IPC kiểm nguồn và tham số; chặn điều hướng, cửa sổ mới (skill `desktop`, `security.md` mục 7). Tauri: capability chỉ có permission cần.
- Quyền hệ thống (camera, vị trí...) xin đúng lúc, có câu giải thích, app vẫn chạy khi bị từ chối.
- Đổi code native thì không đẩy qua OTA.

## Test
- Test kiểm hành vi thật và có assert có ý nghĩa; không mock chính thứ đang được test.
- Bug fix có test tái hiện bug (fail trước khi sửa, pass sau khi sửa).
- Test không phụ thuộc thứ tự chạy, thời gian thực hay mạng ngoài.
- Test cô lập tenant và phân quyền không bị skip.
