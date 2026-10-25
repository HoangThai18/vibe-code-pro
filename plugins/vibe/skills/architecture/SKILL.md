---
name: architecture
description: "Viết code theo đúng kiến trúc, quy ước và logic sẵn có của codebase, và chọn kiến trúc hợp yêu cầu. Dùng mỗi khi thêm tính năng, module, endpoint hay màn hình mới vào một codebase đã có code (để code mới theo đúng pattern, tái dùng helper và error class có sẵn, giữ ranh giới module), khi bắt đầu làm việc trong codebase còn lạ, refactor cấu trúc, chọn hoặc xem lại kiến trúc (modular monolith, layered, hexagonal/clean, DDD, CQRS, event-driven, microservices, serverless), áp SOLID và DDD có chừng mực, hay khi user nhắc 'code theo chuẩn codebase', 'SOLID', 'DDD', 'clean architecture', 'hexagonal', 'tách module', 'nên dùng kiến trúc gì', 'code bị rối'. Sửa nhỏ trong file đã quen thì làm thẳng."
---

# Architecture: kiến trúc và code nhất quán với codebase

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chỉ đọc phần cần cho việc đang làm:

| Việc | Đọc |
|---|---|
| Làm việc trong codebase có sẵn, nhất là lần đầu: tìm và theo quy ước | `references/codebase-conventions.md` |
| Chọn kiến trúc cho dự án hoặc module mới, chia module, ranh giới | `references/architecture-styles.md` |
| Nghiệp vụ phức tạp, nhiều quy tắc và trạng thái | `references/ddd.md` |
| SOLID, nguyên tắc thiết kế, pattern, code smell, refactor | `references/design-principles.md` |

**Cân đúng mức**: sửa nhỏ trong file đã quen (đổi điều kiện, sửa chữ, thêm một trường) thì làm thẳng theo code xung quanh; không cần khảo sát lại cả codebase.

## Thứ tự ưu tiên khi các nguyên tắc mâu thuẫn

0. **Bảo mật, cô lập tenant, tính đúng của dữ liệu không bao giờ được hy sinh để "nhất quán".** Pattern sẵn có thiếu tenant scope, thiếu transaction cho thao tác cần nguyên tử, nuốt lỗi, có lỗ hổng: làm đúng ở phần mình viết, báo user chỗ cũ có vấn đề.
1. **Chỉ dẫn của user, `CLAUDE.md`, ADR** trong `docs/plan/ARCHITECTURE.md`.
2. **Yêu cầu nghiệp vụ**: `docs/domain/DOMAIN.md`, task card.
3. **Pattern đang thấy trong codebase**: cấu trúc, cách đặt tên, cách báo lỗi, cách test. Một codebase nhất quán dễ đọc, dễ sửa hơn một codebase mỗi chỗ "đúng sách" theo một kiểu.
4. **Nguyên tắc chung** (SOLID, DDD, clean architecture): dùng để quyết định ở chỗ codebase chưa có quy ước, không dùng để viết lại những gì đang chạy tốt.

Quy ước về **phong cách và cấu trúc** mà bạn thấy chưa tốt (tên, bố cục file, cách chia lớp) thì đề xuất với user và ghi ADR; đừng tự đổi lẻ tẻ trong một task, vì codebase sẽ có hai cách làm cho cùng một việc.

## Quy tắc luôn áp dụng

1. **Đọc trước khi viết**: tìm 1–2 chỗ đã làm việc tương tự, theo đúng cấu trúc file, cách đặt tên, cách báo lỗi, cách validate, cách test của chúng.
2. **Tái dùng trước khi viết mới**: tìm helper, util, component, error class, client có sẵn (grep theo tên và theo chức năng). Không thêm cách thứ hai để làm cùng một việc (hai thư viện ngày tháng, hai HTTP client, hai kiểu báo lỗi).
3. **Đặt code đúng tầng và đúng module**; phụ thuộc đi theo một chiều (vd route → service → repository). Codebase đã chia module có ranh giới thì module khác đi qua API của module đó, không đọc thẳng bảng của nó; cần nhiều bản ghi thì dùng hàm đọc theo lô, và truyền `tx` vào khi thao tác phải nằm chung transaction.
4. **Logic nghiệp vụ ở một chỗ** (service, domain function, use case), không rải trong controller, component UI hay câu SQL.
5. **Tên theo thuật ngữ chung** trong `DOMAIN.md` và theo kiểu đặt tên của codebase.
6. **Thay đổi nhỏ nhất đủ đúng**: không refactor ngoài phạm vi task; thấy chỗ cần dọn thì ghi task card riêng.
7. **Trừu tượng hoá khi đã có nhu cầu thật**: thường là khi có biến thể thứ hai thật sự, hoặc ở ranh giới với hệ thống bên ngoài; không vì "sau này có thể cần".
8. **Khuyến nghị kiến trúc luôn có điều kiện xem lại cụ thể, đo được**: chọn gì, cho phần nào, vì sao hợp với team và giai đoạn hiện tại, và khi nào phải xem lại (vd "tách module thông báo thành service khi có team riêng phụ trách, hoặc hàng đợi gửi tin trễ quá 5 phút ở giờ cao điểm"). Ghi vào ADR (`references/architecture-styles.md` mục 6).

## Trước khi coi là xong

- Diff trông như do một người trong team viết: cùng cấu trúc, cùng thư viện, cùng phong cách với module bên cạnh.
- Không có dependency mới nếu không thật cần (cần thì nêu lý do).
- Không chép lại logic đã có ở nơi khác; không có import ngược chiều hay vòng tròn giữa các module.
- Lint, format, typecheck theo cấu hình của dự án đều pass.
- Phát hiện quy ước quan trọng mà `CLAUDE.md` chưa ghi: đề xuất vài dòng để user duyệt (chỉ session chính sửa `CLAUDE.md`; sub-agent ghi đề xuất vào báo cáo).
