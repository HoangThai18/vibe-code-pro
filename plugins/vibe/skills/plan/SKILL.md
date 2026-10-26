---
name: plan
description: "Lên kế hoạch dự án trước khi code: phân tích nghiệp vụ (vai trò, quy trình, quy tắc, vòng đời dữ liệu), research người dùng, đối thủ và tech stack (đọc tài liệu đúng version, chọn thư viện), viết PRD, chọn nền tảng (web, app mobile, app desktop), chốt kiến trúc, chia phase, tạo CLAUDE.md. Dùng khi bắt đầu một sản phẩm, hệ thống hoặc tính năng lớn ('lên plan', 'kickoff', 'phân tích nghiệp vụ', 'viết PRD', 'research', 'chọn tech stack', 'thiết kế kiến trúc', 'chia phase'), hoặc khi nghiệp vụ còn mơ hồ. Prototype nhỏ thì chỉ cần plan một trang."
---

# Plan: từ ý tưởng tới kế hoạch build được

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Các đường dẫn `references/` và `templates/` dưới đây tính từ thư mục này; chỉ đọc file nào khi tới bước cần nó.

Mục tiêu: trước dòng code đầu tiên, có đủ tài liệu để một kỹ sư hay agent mới vào đọc là hiểu build gì, cho ai, theo quy tắc nghiệp vụ nào, bằng công nghệ gì, theo thứ tự nào. Lỗi đắt nhất của vibe code là code đúng kỹ thuật nhưng sai nghiệp vụ, và phần lớn lỗi đó bắt được ở bước này.

Skill không viết code ứng dụng. Nó bổ sung cho plan mode của Claude Code: plan mode lo một lần thay đổi, còn skill này lo cả dự án và lưu kết quả thành file trong repo.

## Cân đúng mức

- **Prototype, demo, công cụ nhỏ**: một file `docs/plan/PLAN.md` (mục tiêu, phạm vi, stack, 3–5 bước). Hỏi user trước khi làm bản đầy đủ.
- **Sản phẩm thật, nhiều vai trò, nhiều khách hàng**: đi đủ các bước dưới. Bước nào không áp dụng (vd nghiệp vụ quá đơn giản) thì ghi một dòng lý do rồi bỏ qua.

## Quy trình

1. **Làm rõ yêu cầu (1–2 lượt hỏi).** Đọc kỹ những gì user đã đưa; repo có sẵn code thì khảo sát trước (cấu trúc, package, schema, test, CI). Gom câu hỏi thành danh sách đánh số, mỗi câu kèm phương án mặc định để user trả lời nhanh: người dùng và vai trò, nền tảng (web, app mobile, app desktop), 3–5 luồng chính, quy mô và có nhiều khách hàng dùng chung không, ràng buộc (stack, hạn, ngân sách, pháp lý), tích hợp, ngoài phạm vi.
2. **Phân tích nghiệp vụ** → `docs/domain/DOMAIN.md` theo `templates/DOMAIN.md`. Đọc `references/domain-analysis.md`. Đây là nơi chốt thuật ngữ, quy tắc và vòng đời dữ liệu; mọi bước sau dựa vào nó.
3. **Research** → `docs/research/<chủ-đề>.md` theo `templates/RESEARCH.md`. Đọc `references/tech-research.md`. Gồm hai loại: người dùng/đối thủ (tính năng mà ngành coi là chuẩn) và kỹ thuật (chọn stack, thư viện, dịch vụ; đọc tài liệu đúng version).
4. **PRD** → `docs/plan/PRD.md` theo `templates/PRD.md`: vấn đề, vai trò, mục tiêu đo được, luồng chính kèm tiêu chí chấp nhận, phạm vi, phi chức năng, giả định. Một đến hai trang.
5. **Kiến trúc** → `docs/plan/ARCHITECTURE.md` theo `templates/ARCHITECTURE.md`:
   - Công nghệ "nhàm chán" trước; thành phần nào thêm vào (queue, cache, search, microservice) cũng phải trả lời được "bỏ nó đi thì cái gì vỡ?".
   - Nền tảng: web là mặc định; cần app mobile hay desktop thì chọn cách làm theo `${CLAUDE_SKILL_DIR}/../mobile/references/choose-stack.md` và `${CLAUDE_SKILL_DIR}/../desktop/references/choose-stack.md`. App cài trên máy kéo theo phát hành qua store, ký số, và API phải tương thích với bản cũ: ghi vào ADR ngay từ đầu.
   - Chọn kiểu kiến trúc theo quy mô team và độ phức tạp nghiệp vụ (`${CLAUDE_SKILL_DIR}/../architecture/references/architecture-styles.md`); mặc định là modular monolith, tách service khi có lý do đo được. Miền nghiệp vụ phức tạp thì xem thêm `${CLAUDE_SKILL_DIR}/../architecture/references/ddd.md`.
   - Data model nháp từ các thực thể trong DOMAIN.md. Hệ thống nhiều khách hàng dùng chung thì chọn mô hình tenancy ngay bây giờ (`${CLAUDE_SKILL_DIR}/../backend/references/multi-tenant.md`), vì đổi về sau rất đắt.
   - Chốt sớm các quyết định khó đảo ngược (tenancy, auth, định dạng ID, tiền, thời gian, cách deploy), ghi vào bảng ADR kèm lý do và phương án đã loại.
6. **Phase** → `docs/plan/PHASES.md` theo `templates/PHASES.md`:
   - P0 là nền móng: repo, lint/test/CI, auth, tenancy, layout, **deploy được lên staging** (skill `ship`). Phase sau đứng trên nền đó.
   - Mỗi phase sau là một lát cắt dọc (DB → API → UI) cho một luồng người dùng, kết thúc bằng thứ demo và deploy được, không chia kiểu "xong BE" rồi "xong FE".
   - Mỗi phase có mục tiêu, phạm vi, exit criteria kiểm chứng được, màn hình cần design, rủi ro; cỡ 5–15 task.
7. **`CLAUDE.md`** theo `templates/CLAUDE.template.md`: lệnh, cấu trúc, quy tắc bắt buộc, quy ước. Repo đã có thì bổ sung, không ghi đè. Viết ngắn, chỉ những điều Claude không tự suy ra được từ code. Công cụ cho Claude trong dự án (tra tài liệu, trình duyệt, Figma, DB, GitHub, LSP) chọn theo `references/dev-tools.md`: chỉ cái dự án cần, quyền tối thiểu, không bao giờ nối vào production.
8. **Chốt với user**: tóm tắt mục tiêu, kiến trúc trong 5 dòng, danh sách phase, giả định và câu hỏi còn mở. Duyệt xong thì chuyển sang skill `tasks` để chia task cho P0 (phase có UI mới thì design trên Claude Design trước).
