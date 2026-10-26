# Thiết kế tính năng AI

## Mục lục
1. Có nên dùng AI không
2. Chọn kiểu tính năng
3. Chọn model và effort
4. Đưa dữ liệu vào: cả ngữ cảnh hay tìm trước (RAG)
5. Trải nghiệm người dùng
6. Dữ liệu gửi cho nhà cung cấp

## 1. Có nên dùng AI không

Dùng khi kết quả "gần đúng, người dùng sửa được" vẫn có ích: tóm tắt, soạn nháp, phân loại, trích xuất từ văn bản tự do, gợi ý. Không dùng khi đã có cách làm chính xác bằng code hoặc SQL: tính tiền, kiểm quyền, đếm số liệu, tra cứu theo khoá. Câu hỏi cho PRD (skill `plan`):

- Người dùng làm gì khi AI sai? Có bước xem lại trước khi kết quả gây hậu quả không?
- Thế nào là "đủ tốt"? Viết thành vài ví dụ đầu vào kèm kết quả mong muốn: đó là hạt giống của bộ eval (`testing.md`).
- Chi phí mỗi lần dùng và số lần dùng ước tính mỗi tháng (`cost.md` mục 1) có hợp với giá bán không?

## 2. Chọn kiểu tính năng

| Kiểu | Khi nào | Ví dụ |
|---|---|---|
| Một lần gọi | Đầu vào và đầu ra rõ, một bước | Tóm tắt ghi chú, phân loại ticket, trích xuất thông tin từ email |
| Workflow do code điều khiển | Vài bước cố định, code quyết định thứ tự | Phân loại → nếu là khiếu nại thì soạn nháp trả lời → nhân viên duyệt |
| Agent dùng công cụ | Không biết trước cần bao nhiêu bước, model tự chọn công cụ | Trợ lý trả lời câu hỏi về lịch hẹn, tự tra lịch và khách |

Bắt đầu từ kiểu đơn giản nhất làm được việc. Agent tốn hơn, chậm hơn, khó test hơn, và mỗi công cụ là thêm một đường cho prompt injection gây hại (`safety.md` mục 3). Với agent dùng công cụ của bạn, SDK có Tool Runner lo vòng lặp gọi công cụ; skill `claude-api` có cách dùng đúng bản SDK.

## 3. Chọn model và effort

- Mặc định dùng model mạnh nhất hiện hành của nhà cung cấp (lúc viết: `claude-opus-5-5`), đặt trong config (`AI_MODEL`), không rải khắp code.
- `output_config.effort` (`low` đến `max`) điều chỉnh độ kỹ và số token: tóm tắt, phân loại, soạn nháp ngắn thường đủ ở `low`; phân tích nhiều bước cần cao hơn. Mức mặc định khác nhau theo model, nên đặt rõ.
- Đổi sang model rẻ hơn (vd `claude-haiku-5-5`) cho việc khối lượng lớn là quyết định của người làm sản phẩm, dựa trên số đo: chạy cùng bộ eval trên hai model, so điểm và chi phí cho mỗi việc hoàn thành.
- Model cũ bị ngừng theo lịch của nhà cung cấp: ghi model đang dùng và ngày kiểm lại vào ADR.

## 4. Đưa dữ liệu vào: cả ngữ cảnh hay tìm trước (RAG)

- **Dữ liệu nhỏ** (ghi chú của một khách, một email, một hợp đồng): đưa thẳng vào prompt. Model hiện tại nhận được rất nhiều token; đơn giản và chính xác hơn RAG.
- **Dữ liệu lớn** (toàn bộ tài liệu hướng dẫn, hàng nghìn ticket): tìm phần liên quan trước rồi mới đưa vào. Bắt đầu bằng full-text search của Postgres (`tsvector`); chỉ thêm tìm theo vector (pgvector + một nhà cung cấp embedding) khi đo được full-text tìm sót.
- Dù tìm cách nào, **query tìm phải lọc tenant** như mọi query khác, và chạy dưới RLS nếu hệ thống dùng RLS (skill `backend`, `multi-tenant.md`). Chỉ mục vector dùng chung mà quên lọc tenant là cách nhanh nhất để AI kể cho khách A dữ liệu của khách B.
- Đưa kèm nguồn (id tài liệu) để giao diện hiện "theo tài liệu X" và người dùng kiểm được.

## 5. Trải nghiệm người dùng

- Câu trả lời dài thì stream từng đoạn (`integration.md` mục 4), có nút dừng; dừng thì huỷ request tới API.
- Ghi rõ nội dung do AI tạo. Nháp gửi cho khách luôn qua bước người dùng xem và sửa.
- Lỗi, hết ngân sách, model từ chối: thông báo ngắn và cách làm tiếp bằng tay, không để màn hình quay mãi.
- Cho người dùng đánh giá nhanh (hữu ích / không) và lưu kèm id lần gọi: nguồn case thật cho bộ eval.
- Tenant tắt được tính năng AI (cờ theo tenant), vì có khách không muốn dữ liệu của họ đi qua dịch vụ AI.

## 6. Dữ liệu gửi cho nhà cung cấp

- Gửi dữ liệu của người dùng cho nhà cung cấp AI là chuyển dữ liệu cho bên xử lý, thường ra nước ngoài: ghi trong chính sách quyền riêng tư và hợp đồng với khách, và làm đúng yêu cầu pháp lý về dữ liệu cá nhân (skill `backend`, `privacy.md`).
- Chỉ gửi phần cần cho việc: tóm tắt ghi chú không cần số điện thoại, email (`safety.md` mục 5).
- Đọc chính sách lưu dữ liệu của nhà cung cấp và tuỳ chọn không lưu (zero data retention) nếu khách yêu cầu; một số model có yêu cầu riêng về lưu dữ liệu.
- Không ghi toàn bộ prompt và câu trả lời vào log thường. Cần lưu để debug thì lưu ở bảng riêng, có hạn xoá và phân quyền đọc.
