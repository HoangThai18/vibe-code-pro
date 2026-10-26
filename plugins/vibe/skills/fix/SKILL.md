---
name: fix
description: "Sửa bug và xử lý sự cố có phương pháp: chốt triệu chứng, tái hiện bằng test trước khi sửa, khoanh vùng nguyên nhân gốc (log theo request id, git bisect, kiểm từng giả thuyết), sửa tối thiểu, chống tái diễn; sự cố production thì giảm thiệt hại trước (rollback, tắt flag), báo tình hình, rồi mới điều tra, cuối cùng viết postmortem. Dùng mỗi khi code cho kết quả sai so với mong đợi ('đang ra X, đúng ra phải là Y', 'sửa giúp'), test đang fail, user báo lỗi, dán stack trace hoặc log, nói 'bug', 'lỗi 500', 'không chạy', 'chậm', 'dữ liệu sai', 'sập', 'hotfix', 'sự cố', 'production có vấn đề'."
argument-hint: "[mô tả lỗi hoặc sự cố]"
---

# Fix: sửa bug và xử lý sự cố

Thư mục skill: `${CLAUDE_SKILL_DIR}`.

Sai lầm phổ biến nhất khi sửa bug là đoán rồi vá: sửa vài chỗ cùng lúc, thấy hết lỗi là dừng, mà không biết chỗ nào mới là nguyên nhân. Bug quay lại, hoặc sinh bug mới. Quy trình dưới đây chậm hơn vài phút nhưng chắc chắn hơn nhiều.

**Cân đúng mức.** Lỗi hiển nhiên có nguyên nhân rõ ngay (lỗi gõ, import sai, lỗi type, câu báo lỗi chỉ thẳng dòng sai): sửa luôn rồi chạy test liên quan, không cần đủ quy trình. Quy trình đầy đủ dành cho lỗi chưa rõ nguyên nhân, lỗi quay lại, hoặc lỗi chạm dữ liệu, tiền, bảo mật.

## Bug thường (chưa gây sự cố production)

1. **Chốt triệu chứng**: mong đợi gì, thực tế ra sao, ở môi trường nào, version/commit nào, tenant và user nào, thời điểm, `requestId` nếu có. Thiếu thông tin quan trọng thì hỏi user một lần, gom đủ câu hỏi.
2. **Tái hiện bằng test**: viết test nhỏ nhất làm lộ bug, chạy để thấy nó **fail đúng lý do**. Không tái hiện được thì chưa sửa; thu thêm dữ liệu (log theo `requestId`, dữ liệu của bản ghi lỗi, các bước của user).
3. **Khoanh vùng nguyên nhân gốc**:
   - Đọc kỹ thông báo lỗi và stack trace tới dòng code của dự án. Lỗi chỉ xảy ra trên trình duyệt (trang trắng, request lỗi, chậm): đọc console, network, performance trace, qua Chrome DevTools MCP nếu dự án có (`${CLAUDE_SKILL_DIR}/../plan/references/dev-tools.md` mục 5).
   - App mobile, desktop: đọc crash report (stack trace đã giải mã bằng source map, dSYM, mapping), lọc theo phiên bản app và hệ điều hành; tái hiện trên đúng phiên bản đó (skill `mobile`, `desktop`, `release.md`).
   - Xem thay đổi gần đây: `git log` của các file liên quan, lần deploy gần nhất. Lỗi mới xuất hiện giữa hai version thì dùng `git bisect` với chính test vừa viết.
   - Liệt kê giả thuyết, kiểm **từng cái một** bằng bằng chứng (log, query, debugger, thêm log tạm). Mỗi lần chỉ đổi một thứ.
   - Hỏi "vì sao" tới khi gặp nguyên nhân thật (thiếu ràng buộc, sai giả định về dữ liệu, race condition), không dừng ở triệu chứng.
4. **Sửa tối thiểu** ở đúng nguyên nhân. Test tái hiện chuyển sang pass, toàn bộ test khác vẫn pass.
5. **Tìm chỗ tương tự**: cùng kiểu lỗi có ở nơi khác không (grep theo pattern). Sửa luôn nếu nhỏ, nếu lớn thì tạo task card.
6. **Chống tái diễn**: test đã có; thêm ràng buộc DB, validate, cảnh báo hoặc ghi chú vào `CLAUDE.md` nếu lỗi do hiểu sai quy ước.
7. **Ghi lại** trong commit hoặc task card: triệu chứng, nguyên nhân gốc, cách sửa. Bug liên quan auth, dữ liệu tenant, tiền, migration thì qua skill `review` trước khi merge.

Không làm: tắt test đang fail, bắt lỗi rồi bỏ qua cho hết báo lỗi, sửa ở nhiều nơi cùng lúc "cho chắc", đóng bug với lý do "máy mình chạy được".

## Sự cố production

Thứ tự ưu tiên: **giảm thiệt hại → thông báo → tìm nguyên nhân → sửa → rút kinh nghiệm**.

1. **Đánh giá mức độ**: bao nhiêu người hoặc tenant bị ảnh hưởng, chức năng nào (thanh toán và dữ liệu nặng hơn giao diện), dữ liệu có bị hỏng hay lộ không.
2. **Giảm thiệt hại trước khi tìm nguyên nhân**: tắt feature flag, deploy lại bản trước (`${CLAUDE_SKILL_DIR}/../ship/references/release-rollback.md`), tạm khoá tính năng hoặc tenant gây tải, tăng tài nguyên nếu do quá tải. Hỏi user trước mọi thao tác ghi trên production.
3. **Thông báo**: người phụ trách và khách bị ảnh hưởng biết đang có sự cố và đang xử lý; cập nhật định kỳ.
4. **Điều tra và sửa** theo quy trình bug ở trên. Hotfix: branch từ tag đang chạy, test tái hiện, review nhanh, deploy qua pipeline, merge ngược về `main`.
5. **Dữ liệu hỏng**: dừng nguồn gây hỏng, xác định phạm vi (bảng, tenant, khoảng thời gian), sửa bằng script có review và kiểm số dòng, hoặc khôi phục một phần từ backup (`${CLAUDE_SKILL_DIR}/../ship/references/backup-restore.md`).
6. **Postmortem** trong 48 giờ theo `templates/POSTMORTEM.md`, không đổ lỗi cá nhân: dòng thời gian, ảnh hưởng, nguyên nhân gốc, cái gì giúp và cái gì cản trở, hành động phòng ngừa (mỗi hành động một task card có người phụ trách).

## Nghi ngờ lộ dữ liệu giữa khách hàng

Lộ dữ liệu cá nhân có thể phải thông báo cơ quan chuyên trách trong 72 giờ kể từ khi phát hiện: ghi thời điểm phát hiện ngay từ đầu và báo người quyết định (`${CLAUDE_SKILL_DIR}/../backend/references/privacy.md` mục 7).

Xử lý như sự cố nghiêm trọng nhất: chặn đường rò ngay (tắt tính năng, chặn endpoint), giữ nguyên log làm bằng chứng, xác định tenant và dữ liệu bị ảnh hưởng, báo người phụ trách và bộ phận pháp lý. Quy định bảo vệ dữ liệu cá nhân của Việt Nam có nghĩa vụ và thời hạn thông báo khi có vi phạm; hỏi pháp chế để làm đúng.
