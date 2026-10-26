---
name: build
description: "Biến task card hoặc yêu cầu tính năng thành code chạy được và có test: mặc định một agent làm cả tính năng lẫn test, kiểm tài liệu đúng version trước khi dùng API lạ, chọn mức test (unit, integration với DB thật, E2E), verify rồi merge. Dùng khi làm một task hoặc tính năng, và mỗi khi viết hoặc sửa test bất kỳ loại nào, nhất là test giao diện và luồng người dùng bằng Playwright (đăng nhập, nhiều vai trò, đổi workspace, so ảnh, a11y, test chập chờn). Cũng dùng khi cân nhắc có nên dùng sub-agent hay chạy song song nhiều task (mặc định là không; chỉ khi các task lớn và độc lập). Ví dụ: 'làm task P1-T03', 'code tiếp', 'build phase', 'viết test', 'test giao diện', 'test luồng người dùng', 'E2E', 'Playwright', 'test chập chờn', 'chạy song song', 'dùng sub-agent cho nhanh'."
---

# Build: từ task card tới code đã kiểm

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Công cụ xem task: `python3 "${CLAUDE_SKILL_DIR}/../tasks/scripts/tasks.py" next --dir docs/tasks`.

| Việc | Đọc |
|---|---|
| Chọn mức test (unit, integration với DB thật, E2E), test chập chờn, test trong CI | `references/testing.md` |
| Test giao diện và luồng người dùng trên trình duyệt bằng Playwright: nhiều vai trò, chụp so sánh giao diện, a11y, mock mạng, debug | `references/e2e-playwright.md` |
| Test app mobile (Jest, React Native Testing Library, Maestro trên emulator) | `${CLAUDE_SKILL_DIR}/../mobile/references/testing.md` |
| Test app desktop (Playwright cho Electron, Tauri, test cấu hình bảo mật) | `${CLAUDE_SKILL_DIR}/../desktop/references/testing.md` |
| Định chạy song song nhiều agent | `references/parallel.md` (và `agent-brief.md`) |

## Mặc định: một agent, một vòng lặp

Session chính làm lần lượt từng task: đọc task card, code, viết test, chạy, sửa, rồi merge. Người viết tính năng cũng viết test cho nó, vì họ đang có đủ ngữ cảnh: biết vì sao chọn cách làm này, chỗ nào dễ vỡ. Chia "agent viết code, agent khác viết test" thì mỗi lần bàn giao là mất ngữ cảnh. Sub-agent chỉ dùng khi thật sự đáng (mục cuối).

**Cân đúng mức.** Repo không dùng `docs/tasks`, hoặc việc nhỏ (sửa vài file, một phiên là xong): bỏ phần task card, branch phase, cập nhật trạng thái. Vẫn giữ phần làm nên chất lượng: đọc code tương tự trước khi viết, test cho thay đổi, chạy verify, chỉ sửa trong phạm vi được yêu cầu.

## Quy trình cho một task

1. **Chọn task**: task mà `next` gợi ý, hoặc task user chỉ định. Đổi `status: doing`, tạo branch `task/<ID>` từ branch phase (`phase/P1`).
2. **Đọc trước khi code**: task card, `CLAUDE.md`, phần liên quan trong `docs/domain/DOMAIN.md` (quy tắc `BR-xx`), contract, design, và 1–2 chỗ trong codebase đã làm việc tương tự để theo đúng cấu trúc và quy ước (codebase còn lạ thì gọi skill `architecture`). Gọi skill `backend`, `frontend`, `mobile` hoặc `desktop` khi task chạm phần đó; skill chỉ nạp phần tài liệu cần dùng.
3. **Kiểm tài liệu khi dùng API chưa chắc**: xem version đang cài và tài liệu đúng version (`${CLAUDE_SKILL_DIR}/../plan/references/tech-research.md`). Không đoán chữ ký hàm.
4. **Code + test cùng lúc**, theo quy ước của codebase (tái dùng helper, error class, component có sẵn; đặt code đúng tầng và module), theo từng sub-task, commit `<ID>: <việc>` sau mỗi bước có nghĩa. Test kiểm từng acceptance criteria và các nhánh lỗi; mức test chọn theo `references/testing.md`.
5. **Chỉ sửa trong `touches`**. Phát hiện cần sửa ngoài phạm vi thì dừng lại và báo user (hoặc tạo task mới), không làm lan.
6. **Verify**: chạy lệnh verify trong task card, cùng typecheck, lint, toàn bộ test liên quan. Task có UI thì chụp ảnh kiểm (skill `frontend`); task chạm luồng chính đã có E2E thì chạy cả E2E của luồng đó.
7. **Review**: task chạm auth, dữ liệu tenant, tiền, migration → skill `review` (verifier độc lập). Task nhỏ, rủi ro thấp → tự soát theo checklist của skill `review`.
8. **Merge** vào branch phase (`git merge --no-ff task/<ID>`), chạy lại toàn bộ test, cập nhật task card (`done`, ghi commit, tick acceptance criteria), xoá branch, commit trạng thái.

## Khi nào mới dùng sub-agent

Chỉ khi có lý do cụ thể, vì mỗi sub-agent tốn token như một phiên riêng và mỗi lần bàn giao làm mất ngữ cảnh:

- **Song song**: từ 2 task trở lên đã sẵn sàng, **lớn** (mỗi task đáng một phiên), **độc lập** (không chung file, không chung DB có migration, không chung port), và user muốn rút ngắn thời gian. Cách làm: `references/parallel.md`.
- **Context quá lớn**: một việc cần đọc rất nhiều file mà chỉ cần kết luận (vd khảo sát cả codebase cũ), thì giao cho sub-agent để giữ context chính gọn.
- **Kiểm chứng độc lập**: verifier của skill `review` cố ý không có ngữ cảnh của người viết, để không bị neo vào cách nghĩ của họ.

Các trường hợp còn lại: làm thẳng ở session chính.
