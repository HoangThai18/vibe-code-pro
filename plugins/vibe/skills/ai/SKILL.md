---
name: ai
description: "Thêm tính năng AI/LLM vào app chạy thật (tóm tắt, phân loại, trích xuất, soạn nháp, chatbot, trợ lý dùng công cụ, tìm trong tài liệu/RAG): gọi Claude API từ server, streaming về giao diện, structured output, chống prompt injection, không lộ dữ liệu giữa tenant, giới hạn chi phí và token theo tenant, cache prompt, xử lý lỗi và timeout, test và eval chất lượng. Dùng khi user muốn 'thêm AI', 'tích hợp Claude', 'LLM', 'chatbot', 'tóm tắt bằng AI', 'gợi ý', 'trích xuất', 'RAG', 'embedding', 'prompt', 'agent trong app', hoặc lo về chi phí, độ chính xác, an toàn của tính năng AI."
---

# AI: tính năng dùng LLM trong app

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chỉ đọc phần cần cho việc đang làm:

| Việc | Đọc |
|---|---|
| Chọn kiểu tính năng (một lần gọi, workflow, agent, tìm trong tài liệu), model, trải nghiệm người dùng, dữ liệu gửi cho nhà cung cấp | `references/design.md` |
| Gọi API từ server, structured output, streaming về trình duyệt, lỗi, timeout, refusal | `references/integration.md` |
| Prompt injection, dữ liệu giữa tenant, quyền của công cụ, xử lý output, che dữ liệu cá nhân | `references/safety.md` |
| Chi phí, ngân sách theo tenant, ghi usage, cache prompt, rate limit | `references/cost.md` |
| Test tự động không tốn tiền, eval chất lượng, theo dõi sau khi chạy thật | `references/testing.md` |

Ví dụ viết bằng TypeScript với `@anthropic-ai/sdk`. Model ID, tham số và giá đổi nhanh hơn mọi thư viện khác: trước khi viết code gọi API, đọc tài liệu hiện hành. Claude Code có skill `claude-api` đi kèm: gọi nó để lấy model ID và cách dùng SDK đúng bản đang cài, không viết theo trí nhớ. Dùng nhà cung cấp khác thì giữ nguyên các nguyên tắc dưới đây, đổi phần gọi API.

**Cân đúng mức.** Sửa câu chữ trong prompt thì chạy lại eval rồi làm thẳng. Đọc kỹ `references/safety.md` khi tính năng đọc dữ liệu do người khác nhập (ghi chú, email, tài liệu, trang web) hoặc cho model gọi công cụ.

## Quy tắc luôn áp dụng

1. **Chỉ gọi API từ server.** API key không bao giờ nằm trong frontend, app mobile, app desktop. Endpoint AI đi qua xác thực, kiểm quyền và lấy tenant như mọi endpoint khác.
2. **Dữ liệu không phải chỉ dẫn.** System prompt cố định, không ghép dữ liệu người dùng vào đó. Ghi chú, email, tài liệu, kết quả công cụ đưa vào tin nhắn người dùng dưới dạng JSON hoặc trong thẻ rõ ràng, kèm câu nói đó là dữ liệu. Không tin rằng câu này đủ chặn mọi injection: quyền của tính năng mới là thứ giới hạn thiệt hại (quy tắc 3).
3. **Model chỉ làm được những gì người dùng hiện tại được làm.** Công cụ cho model gọi chạy với quyền của người dùng đó và trong tenant đó; hành động có hậu quả (gửi tin cho khách, xoá, trả tiền) để người dùng bấm xác nhận.
4. **Tenant trong mọi dữ liệu đưa vào prompt**: lấy qua repository có lọc tenant (và RLS) như mọi query khác. Không gộp dữ liệu nhiều tenant vào một prompt; cache kết quả AI theo tenant.
5. **Output của model là dữ liệu chưa tin**: validate bằng schema (structured output), hiển thị dạng text (không `innerHTML` với markdown thô), không chạy làm SQL, lệnh shell hay URL chuyển hướng.
6. **Có trần chi phí**: `max_tokens` hợp lý, ngân sách theo tenant mỗi tháng, giới hạn số lần gọi theo người dùng, ghi usage từng lần gọi (`references/cost.md`).
7. **AI hỏng không kéo sập luồng chính.** Timeout, retry có giới hạn (SDK đã retry), xử lý `stop_reason` (`refusal`, `max_tokens`); báo "AI tạm thời không dùng được" và cho người dùng làm tiếp bằng tay.
8. **Đổi prompt, model, effort thì chạy lại eval** trước khi merge. Không có eval thì không biết thay đổi làm tốt lên hay tệ đi.

## Trước khi coi là xong

- Test tự động pass, không gọi API thật (fetch giả trong `references/testing.md`), gồm: request không chứa dữ liệu tenant khác, hết ngân sách thì không gọi, lỗi tạm thời ra thông báo thân thiện.
- Eval chạy với API thật đạt ngưỡng đã thống nhất, gồm vài case có câu chèn chỉ dẫn; ghi số điểm và chi phí vào mô tả PR.
- Usage được ghi theo tenant; có cảnh báo khi chi phí hoặc tỉ lệ lỗi tăng bất thường (skill `ship`, `observability.md`).
- Người dùng biết nội dung do AI tạo (nhãn, nút sửa trước khi gửi) và tắt được tính năng nếu tenant không muốn.
