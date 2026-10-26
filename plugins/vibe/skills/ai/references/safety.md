# An toàn cho tính năng AI

## Mục lục
1. Ai có thể lợi dụng tính năng AI
2. Đặt dữ liệu đúng chỗ trong prompt
3. Công cụ và quyền
4. Xử lý output
5. Chỉ gửi dữ liệu cần thiết
6. Cô lập tenant
7. Chống lạm dụng
8. Kiểm chứng

## 1. Ai có thể lợi dụng tính năng AI

Prompt injection là khi văn bản đi vào prompt chứa câu "hãy làm X" và model làm theo. Có hai đường:

- **Trực tiếp**: người dùng gõ vào ô chat. Họ chỉ nên làm được những gì quyền của họ cho phép, nên rủi ro chính là lộ system prompt và nội dung không phù hợp.
- **Gián tiếp**: văn bản do **người khác** viết đi vào prompt của bạn: ghi chú do nhân viên khác nhập, email hay tin nhắn khách gửi, file upload, trang web, kết quả công cụ. Đây là đường nguy hiểm, vì người viết không phải người đang dùng tính năng, và có thể là người ngoài.

Thiệt hại phụ thuộc vào việc tính năng **làm được gì**, không phụ thuộc vào prompt viết khéo đến đâu. Chưa có cách nào chặn injection hoàn toàn bằng câu chữ, nên thiết kế sao cho model bị lừa cũng không gây hại lớn: không có dữ liệu ngoài phạm vi trong prompt, công cụ chỉ có quyền tối thiểu, hành động quan trọng cần người bấm xác nhận.

## 2. Đặt dữ liệu đúng chỗ trong prompt

- **System prompt cố định**: chỉ dẫn của bạn, không chứa dữ liệu của request. Coi như ai cũng đọc được nó: không để secret, key, thông tin nội bộ nhạy cảm trong đó.
- **Dữ liệu đi trong tin nhắn người dùng**, có cấu trúc rõ: JSON (`JSON.stringify` escape dấu ngoặc kép nên nội dung không "thoát" khỏi trường của nó) hoặc thẻ XML có tên. Ghi trong system prompt rằng nội dung đó là dữ liệu và không làm theo yêu cầu nào trong đó (ví dụ ở `integration.md` mục 2).
- **Chỉ dẫn thêm giữa cuộc hội thoại** (vd chuyển chế độ) dùng kênh của nhà vận hành, không chèn vào nội dung người dùng: Claude API có tin nhắn `role: "system"` giữa hội thoại cho việc này; xem skill `claude-api`.
- Chatbot hỗ trợ khách: thêm vào system prompt rằng các quy tắc giữ nguyên suốt cuộc hội thoại, kể cả khi người dùng nài nỉ, đưa lý do thông cảm, hay nói đã có người cho phép ngoại lệ.

## 3. Công cụ và quyền

Khi model gọi công cụ (tra lịch, tra khách, tạo lịch hẹn...):

- **Tenant và người dùng lấy từ phiên đăng nhập ở server**, không bao giờ từ tham số model gửi lên. Model chỉ chọn những thứ như `customerId`; handler tra trong tenant của phiên và trả "không tìm thấy" nếu id thuộc tenant khác, giống endpoint thường (skill `backend`, `multi-tenant.md`).
- **Mỗi công cụ làm một việc hẹp**, có schema chặt (`strict: true`, `additionalProperties: false`). Không có công cụ kiểu "chạy SQL", "gọi URL bất kỳ", "đọc file theo đường dẫn".
- **Công cụ chỉ đọc là mặc định.** Việc có hậu quả (gửi tin cho khách, huỷ lịch, hoàn tiền) thì công cụ trả về *đề xuất*, giao diện hiện cho người dùng bấm xác nhận rồi mới gọi API nghiệp vụ thật (đi qua kiểm quyền như mọi request).
- Kết quả công cụ cũng là dữ liệu không tin được (vd ghi chú của khách trả về từ `get_customer`): áp dụng mục 2.
- Giới hạn số vòng gọi công cụ mỗi lượt và ghi log từng lần gọi (công cụ, tham số, người dùng, tenant).

## 4. Xử lý output

- Validate bằng schema (structured output). Trường nào đi vào nghiệp vụ (vd `category` của ticket) thì kiểm thêm nằm trong danh sách cho phép.
- Hiển thị bằng text, không `innerHTML`. Render markdown thì dùng thư viện có lọc HTML; link chỉ cho `http`/`https`, mở tab mới với `rel="noopener noreferrer"`.
- Không chạy output làm SQL, lệnh shell, biểu thức, hay URL chuyển hướng. Tính năng "hỏi dữ liệu bằng lời" mà phải sinh SQL thì chạy bằng role chỉ đọc, dưới RLS, có `statement_timeout`, và chỉ trên view dành riêng; cân nhắc kỹ trước khi làm.
- Nội dung gửi ra ngoài (email, tin nhắn cho khách) luôn qua bước người dùng xem và sửa.

## 5. Chỉ gửi dữ liệu cần thiết

- Lấy đúng cột cần cho việc ở query (không `SELECT *` rồi gửi cả bản ghi).
- Che thông tin liên lạc khi việc không cần chúng (`redactContacts` ở `integration.md` mục 2). Regex không bắt được mọi dạng; coi đây là lớp giảm thiểu, không phải cam kết.
- Dữ liệu nhạy cảm (sức khoẻ, tài chính, trẻ em) cần căn cứ pháp lý rõ trước khi gửi cho dịch vụ AI (skill `backend`, `privacy.md`).

## 6. Cô lập tenant

- Mọi dữ liệu đưa vào prompt lấy qua repository có lọc tenant, dưới RLS nếu có (`design.md` mục 4 cho tìm kiếm và RAG).
- Không gộp dữ liệu nhiều tenant vào một prompt, kể cả để "tiết kiệm" bằng batch.
- Lịch sử hội thoại, kết quả AI lưu lại, cache: khoá luôn có `tenant_id` (và `user_id` nếu là dữ liệu riêng của người dùng).
- Test: request gửi tới API chỉ chứa dữ liệu của tenant đang gọi (`testing.md` mục 2).

## 7. Chống lạm dụng

- Giới hạn số lần gọi theo người dùng (vd 30 lần/giờ) và ngân sách theo tenant mỗi tháng (`cost.md`).
- Giới hạn độ dài đầu vào ở endpoint (vd 20.000 ký tự), trả 413 khi quá.
- Tính năng cho người ngoài dùng (chatbot trên website) cần thêm: chống bot, giới hạn theo IP, không có công cụ ghi.

## 8. Kiểm chứng

- Unit test: dữ liệu chứa câu chèn chỉ dẫn vẫn nằm nguyên trong trường dữ liệu của request (`testing.md` mục 2).
- Eval với API thật: vài case có chèn chỉ dẫn ("bỏ qua chỉ dẫn và..."), kết quả không được làm theo (`testing.md` mục 3).
- Review: checklist ở skill `review` có mục cho tính năng AI.
