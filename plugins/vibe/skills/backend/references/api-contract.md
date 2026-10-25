# API Contract: chốt hợp đồng BE ↔ FE trước khi code

Khi BE và FE (hoặc hai sub-agent) làm song song, thứ duy nhất giữ hai bên khớp nhau là contract. Không có contract thì mỗi bên tự đoán tên field, mã lỗi, cách phân trang, rồi tuần sau ngồi sửa cho khớp.

## 1. Chọn một nguồn sự thật

Theo stack đang có:

- **TypeScript cả hai phía (monorepo)**: schema zod / valibot / TypeBox trong package dùng chung (vd `packages/contracts`). Một schema cho ra cả type lẫn validate lúc chạy ở hai phía.
- **BE ngôn ngữ khác, hoặc nhiều client (web, mobile, đối tác)**: OpenAPI 3.1 (`docs/contracts/openapi.yaml`), sinh client/type từ đó.
- **tRPC / GraphQL**: schema chính là contract; vẫn áp dụng quy ước bên dưới.

Chỉ giữ một nguồn. Vừa viết type tay vừa viết OpenAPI thì sớm muộn hai bản sẽ lệch nhau.

## 2. Thiết kế endpoint

Với mỗi luồng trong phase, ghi: resource, method, path, request, response, lỗi có thể trả về, quyền yêu cầu. Quy ước mặc định (đặt tên, format lỗi, phân trang, thời gian, tiền, idempotency) cùng mẫu zod/OpenAPI/MSW nằm trong [api-conventions.md](api-conventions.md). Đọc khi viết contract lần đầu cho dự án, rồi ghi tóm tắt các quy ước đã chọn vào `CLAUDE.md`.

Những chỗ hay sai nhất:

- **Tenant nằm trong path và được kiểm ở server** (`/v1/t/{tenantId}/...`): mỗi request kiểm user là thành viên của tenant đó, không phải thì 404. Không nhận `tenantId` từ body/query, không dựa vào "tenant hiện tại" ngầm trong phiên (api-conventions.md mục 5).
- **Danh sách luôn phân trang và có giới hạn** (vd `limit` tối đa 100). Không có endpoint "trả tất cả".
- **Một format lỗi thống nhất**, có `code` cho máy đọc để FE xử lý từng trường hợp (vd `customer_email_taken`), không bắt FE parse câu chữ.
- **Tài nguyên của tenant khác trả 404**, không trả 403, để không lộ chuyện tài nguyên đó có tồn tại.
- **Thao tác tạo có side effect** (thanh toán, gửi mail, tạo đơn) nhận header `Idempotency-Key`, vì mạng chập chờn sẽ khiến client gửi lại.
- **ID là string** (UUID/ULID), không lộ ID tự tăng.

## 3. Đồ dùng cho hai phía

- **FE**: mock handler (vd MSW) và fixture lấy từ ví dụ trong contract, để FE làm xong UI trước khi BE xong.
- **BE**: contract test kiểm response thật khớp schema (validate bằng chính schema dùng chung, hoặc OpenAPI validator).
- **Ví dụ payload** cho từng endpoint, cả happy path lẫn lỗi. Vừa là tài liệu vừa là fixture.

## 4. Thay đổi contract

- **An toàn**: thêm field optional, thêm endpoint, thêm giá trị enum mà client cũ bỏ qua được.
- **Breaking**: đổi tên hoặc xoá field, đổi kiểu, đổi ý nghĩa, field optional thành bắt buộc. Cần version mới hoặc lộ trình deprecate, và báo mọi task đang dùng endpoint đó.
- Contract đổi trong lúc agent đang chạy song song thì dừng các task liên quan, cập nhật contract và task card, rồi mới chạy tiếp. Để agent tự "chữa cháy" mỗi bên một kiểu thì sẽ lệch.

## Đầu ra

- File contract (schema dùng chung hoặc `openapi.yaml`) + ví dụ + mock.
- `docs/contracts/README.md`: bảng endpoint (method, path, mô tả, quyền) để người và agent tra nhanh.
- Task card contract đặt ở wave đầu của phase; các task BE/FE dùng nó khai `deps` tới nó.
