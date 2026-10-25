# Mẫu brief cho sub-agent (implementer)

Dùng khi chạy song song (parallel.md). Sub-agent bắt đầu với context trống: nó chỉ có CLAUDE.md và những gì bạn viết ở đây. Viết như đang giao việc cho một kỹ sư giỏi mới vào dự án hôm nay: đủ bối cảnh để không phải đoán, đủ ranh giới để không làm lan. Thay các chỗ trong ngoặc nhọn bằng thông tin thật; bỏ dòng không áp dụng.

```text
Bạn đang làm task {ID} của dự án {tên dự án}.

## Việc cần làm
Đọc task card: {docs/tasks/ID-slug.md}. Đó là nguồn yêu cầu chính: mục tiêu, sub-tasks,
acceptance criteria, cách verify, ngoài phạm vi.

## Đọc trước khi code
- CLAUDE.md (lệnh, quy ước, quy tắc bắt buộc)
- {docs/plan/ARCHITECTURE.md, mục liên quan}
- {contract: packages/contracts/src/... hoặc docs/contracts/...}
- {design: docs/design/... và mockup, nếu task có UI}
- Code mẫu nên bắt chước: {đường dẫn module tương tự đã làm tốt}
- Skill nên gọi: {backend nếu task chạm DB, API hoặc dữ liệu tenant; frontend nếu task có UI hoặc state}

## Môi trường chạy của riêng bạn
Có agent khác đang chạy song song trên cùng máy, nên:
- Dev server chạy ở PORT={3101}, không dùng port mặc định. Xong việc thì tắt server.
- Test chạm DB dùng DATABASE_URL={...app_test_p1_t03}. Không dùng DB dev chung.
- Làm việc trong thư mục hiện tại (worktree của bạn). Chạy từng lệnh đơn giản; không ghép
  nhiều lệnh bằng cd/&&/;, vì lệnh ghép dễ bị chặn quyền.

## Ranh giới
- Chỉ tạo/sửa file trong: {touches}. Cần sửa ngoài phạm vi đó thì dừng lại và báo, đừng tự làm.
- Không đổi contract API, schema DB, không thêm dependency mới, trừ khi task card giao đúng việc đó.
- Không sửa task card và docs/STATUS.md; người điều phối cập nhật dựa trên báo cáo của bạn.
- Agent khác đang làm: {ID khác: phạm vi của họ}. Không chạm vào phạm vi đó.

## Cách làm
1. Worktree mới có thể chưa có dependencies: chạy lệnh cài đặt trong CLAUDE.md trước.
2. Làm theo sub-tasks; commit sau mỗi bước có nghĩa, message "{ID}: <việc>".
3. Viết hoặc cập nhật test cho từng acceptance criteria.
4. Chạy verify: {lệnh verify trong task card}, cùng typecheck và lint liên quan.

## Báo cáo khi xong (đúng format này)
- Worktree: <kết quả pwd> · Branch: <git rev-parse --abbrev-ref HEAD> · Commit cuối: <git rev-parse HEAD>
- Đã làm: 3–6 gạch đầu dòng
- File thay đổi: danh sách ngắn
- Verify: lệnh đã chạy + kết quả (dán dòng tóm tắt pass/fail)
- Acceptance criteria: từng tiêu chí đạt hay chưa, bằng chứng (tên test, output)
- Ảnh chụp (task UI): đường dẫn trong worktree
- Cần người điều phối xem: quyết định đã tự đưa ra, rủi ro, việc còn dở (hoặc "không có")

Bị chặn thì dừng sớm và trả lời bắt đầu bằng "BLOCKED: <lý do> | cần: <gì>". Ví dụ: lệnh bị từ chối
quyền (ghi đúng lệnh), contract thiếu field, cần sửa ngoài phạm vi. Đừng tìm đường vòng quanh một
lệnh bị từ chối.
```

## Mẹo viết brief

- **Trỏ tới file thay vì chép nội dung**: agent tự đọc task card và contract, nên brief ngắn mà vẫn đủ. Chỉ chép những gì không có trong file, vd quyết định vừa chốt trong chat.
- **Nêu rõ phạm vi của agent chạy song song** để hai bên không cùng sửa một chỗ.
- **Nói rõ "xong" là gì**: lệnh verify cụ thể, không phải "test cho kỹ".
- **Cấp port và DB riêng** ngay trong brief. Hai agent cùng dùng một port thì ảnh chụp verify có thể là app của agent kia.
- **Đừng đưa kết luận của bạn cho agent review**: brief cho reviewer chỉ gồm code, yêu cầu và checklist (xem skill `review`).
