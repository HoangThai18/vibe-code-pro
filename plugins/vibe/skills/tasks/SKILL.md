---
name: tasks
description: "Quản lý công việc của dự án bằng task card trong docs/tasks: chia phase thành task và sub-task có deps, touches, acceptance criteria; dùng script để kiểm lỗi, xếp thứ tự và xem task nào chạy cùng lúc được; theo dõi tiến độ, chọn việc tiếp theo, ghi handoff cuối phiên. Dùng khi user nói 'chia task', 'break down', 'tới đâu rồi', 'làm gì tiếp', 'xem tiến độ', 'tổng kết phiên', 'mai làm tiếp', hoặc vừa chốt PHASES.md. Repo chưa có docs/plan hay docs/tasks thì chỉ dùng khi user muốn làm theo quy trình này."
---

# Tasks: chia việc, theo dõi tiến độ, nối phiên

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Công cụ đi kèm:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/tasks.py" check  --dir docs/tasks   # lỗi: id trùng, deps sai, vòng phụ thuộc, thiếu touches
python3 "${CLAUDE_SKILL_DIR}/scripts/tasks.py" status --dir docs/tasks   # tiến độ theo phase
python3 "${CLAUDE_SKILL_DIR}/scripts/tasks.py" next   --dir docs/tasks   # task làm được ngay, ưu tiên task mở khoá nhiều task khác
python3 "${CLAUDE_SKILL_DIR}/scripts/tasks.py" waves  --dir docs/tasks --phase P1   # thứ tự làm theo đợt deps
# Thêm --max-parallel N vào next/waves chỉ khi đã quyết định chạy song song (skill build): script chia lượt sao cho không hai task nào sửa chung file
```

(Windows: `python` hoặc `py -3`. Không chạy được Python thì đọc frontmatter các task card và tự tổng hợp theo cùng quy tắc.)

Mọi thứ quan trọng (task, trạng thái, quyết định) nằm trong file của repo, không nằm trong trí nhớ của một cuộc chat, nên phiên nào cũng làm tiếp được.

**Cân đúng mức.** Task card dành cho việc nhiều bước, kéo dài nhiều phiên. Sửa nhỏ hoặc tính năng làm xong trong một phiên thì không cần card: làm luôn (skill `build`), hoặc liệt kê vài bước trong chat. Repo chưa dùng `docs/tasks` thì hỏi user trước khi dựng cả hệ thống này.

## Việc A: chia phase thành task

Đầu vào: phase trong `docs/plan/PHASES.md` (chưa có thì hỏi user có muốn dùng skill `plan` trước không; tính năng nhỏ thì chia thẳng từ mô tả), `DOMAIN.md`, `ARCHITECTURE.md`, design, contract, và code hiện có để ghi đúng đường dẫn.

1. Bắt đầu từ exit criteria của phase, đi ngược ra việc cần làm.
2. Tách theo lane và thứ tự tự nhiên: **DB** (các task migration luôn tuần tự với nhau) → **contract API** (lane BE, task card ghi rõ "task này tạo contract") → **BE** và **FE** / **MOBILE** / **DESKTOP** (client dùng mock theo contract) → **INFRA / DOC** khi cần. Lane **QA** chỉ dành cho test xuyên nhiều task, vd E2E cho luồng người dùng quan trọng của phase (`${CLAUDE_SKILL_DIR}/../build/references/e2e-playwright.md`).
3. Một task = một người (hoặc agent) làm cả tính năng lẫn test của nó, vừa một phiên làm việc, review được trong 15–30 phút (thường dưới ~400 dòng diff). Sub-task là một bước commit được. Quá 7 sub-task hoặc size L thì tách.
4. Acceptance criteria phải kiểm chứng được bằng lệnh, test hoặc ảnh chụp, dẫn số quy tắc nghiệp vụ `BR-xx` nếu có. Câu như "code sạch", "chạy ổn" thì không kiểm được.
5. Khai `touches` đầy đủ: mọi file/thư mục sẽ tạo hoặc sửa, kể cả mock, fixture, test helper, và file "điểm nóng" (router index, schema tổng, `package.json`, lockfile, i18n, `migrations/`). Mọi file nhắc tới trong mục tiêu và acceptance criteria phải nằm trong `touches`.
6. Task tạo bảng hoặc endpoint chạm dữ liệu của nhiều khách hàng thì test cô lập tenant nằm trong acceptance criteria của **chính task đó** (người viết code viết luôn test, theo bước 3), không tách thành task QA để làm sau.
7. Ghi "Ngoài phạm vi" để không làm lan sang task khác.

Mỗi task một file `docs/tasks/<id>-<slug>.md` theo `templates/task.md`; id dạng `P1-T03`. Mẫu thật: `examples/mini-crm/` (đọc `P1-T03-customers-api.md`). Frontmatter là thứ script đọc:

```yaml
---
id: P1-T03
title: API CRUD khách hàng
phase: P1
lane: BE              # DB | BE | FE | MOBILE | DESKTOP | INFRA | QA | DOC
status: todo          # todo | doing | review | done | blocked
deps: [P1-T01, P1-T02]
touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts]
size: M               # S | M | L
---
```

Title có dấu `#` thì đặt trong ngoặc kép (YAML coi `#` sau khoảng trắng là comment). Chạy `check` tới khi sạch, rồi trình bày bảng `ID | Lane | Task | Deps | Size` cho user duyệt.

## Việc B: tiến độ và việc tiếp theo

1. `docs/HANDOFF.md` có thì đọc trước (lời nhắn phiên trước), nhưng đối chiếu với `git log` và task card vì nó có thể đã cũ.
2. Chạy `status` và `next`; xem `git status`, branch hiện tại, worktree còn mở.
3. Báo cáo tối đa ~10 dòng: phase hiện tại, x/y task, đang làm gì, cái gì bị chặn và cần ai quyết.
4. Đề xuất **một** bước tiếp theo:
   - Có task `doing`: làm tiếp cho xong task đó trước (một agent làm lần lượt từng task). Không thấy dấu vết đang làm (commit, branch, worktree, agent đang chạy) thì hỏi user task đó còn ai làm không.
   - Không có task dở: làm task đầu tiên mà `next` gợi ý bằng skill `build`. Chỉ đề xuất chạy song song khi có từ 2 task lớn, độc lập, và user muốn nhanh (điều kiện trong skill `build`).
   - Task ở `review` (code xong, chưa merge): skill `review` trước, vì nó đang giữ file và chặn task sau.
   - Phase hết task: `review` cho cả phase, rồi skill `ship` để đưa lên staging hoặc production.
   - Task `blocked`: nói rõ cần user quyết định gì.
5. Trạng thái có thay đổi thì cập nhật `docs/STATUS.md` (theo `templates/STATUS.md`, tạo mới nếu chưa có) và commit. User chỉ hỏi "tới đâu rồi" thì trả lời trong chat là đủ.

## Việc C: handoff cuối phiên

Khi user nói "tổng kết", "dừng ở đây", "mai làm tiếp", hoặc context đã dài: viết `docs/HANDOFF.md` theo `templates/HANDOFF.md`, ghi trạng thái chính xác (sub-task nào, file nào, lỗi gì, lệnh nào đang fail). Phiên sau làm xong các việc trong đó thì chuyển file sang `docs/handoffs/YYYY-MM-DD.md` để không đọc lại lời nhắn cũ.

## Quy ước

- Trạng thái: `todo` → `doing` (đang làm) → `review` (code xong, **chưa merge**, vẫn giữ file của nó) → `done` (đã merge vào branch phase); `blocked` kèm lý do trong Ghi chú.
- Branch: mỗi phase một branch tích hợp (`phase/P1`); mỗi task một branch riêng (`task/P1-T03`, hoặc branch do Claude Code đặt khi chạy trong worktree); hết phase mở PR `phase/P1 → main`.
- Commit: `<TASK-ID>: <việc>`. Chỉ session chính ghi task card và STATUS.md, nên không có conflict trên các file trạng thái.
