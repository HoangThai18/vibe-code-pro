# Chạy song song bằng sub-agent

Chỉ dùng khi đủ điều kiện ở mục 0. Mặc định của bộ skill là một agent làm lần lượt từng task, vì mỗi sub-agent tốn token như một phiên riêng, mỗi lần bàn giao làm mất ngữ cảnh, và chạy song song còn sinh thêm việc điều phối (worktree, port, DB, merge). Cách làm này đáng khi tiết kiệm được nhiều thời gian hơn hẳn chi phí đó.

Script xem task (từ file này: `../../tasks/scripts/tasks.py`): `tasks.py next --max-parallel 3` và `tasks.py waves --phase P1 --max-parallel 3`.

## 0. Có nên chạy song song không

Chỉ chạy song song khi **đủ cả** các điều kiện:

- Từ 2 task trở lên đã sẵn sàng và không đụng file nhau (`next --max-parallel N` hoặc `waves --max-parallel N` mới kiểm và báo xung đột file; `next` mặc định chỉ gợi ý một task).
- Mỗi task đủ lớn để đáng một phiên riêng (size M trở lên). Task nhỏ thì làm lần lượt nhanh hơn.
- Các task độc lập về môi trường chạy: không cùng dùng một DB có migration, có thể cấp port và DB test riêng cho từng agent.
- User muốn rút ngắn thời gian và chấp nhận tốn token hơn.

Thiếu một điều kiện thì làm lần lượt theo quy trình trong SKILL.md.

## 1. Chuẩn bị

1. **Branch tích hợp**: đứng trên `phase/P1`, test đang pass.
2. **Worktree tách nhánh từ HEAD**: `.claude/settings.json` phải có `{ "worktree": { "baseRef": "head" } }`. Mặc định Claude Code tạo worktree cho sub-agent từ default branch trên remote (thường `origin/main`), nên thiếu setting này thì agent không thấy code của phase. Hỏi user trước khi thêm.
3. **Quyền cho agent**: sub-agent chạy nền, mọi lệnh cần duyệt của nó đều hiện lên session chính. Đề xuất user cấp sẵn quyền cho lệnh test, typecheck, lint, cài đặt, `git add`, `git commit` trong `permissions.allow`, vd `"Bash(pnpm test:*)", "Bash(git commit:*)"`. Không tự sửa settings khi user chưa đồng ý.
4. **Môi trường riêng cho từng agent**: worktree chỉ tách file, còn port, database, cache vẫn dùng chung. Cấp mỗi agent một port dev server (3101, 3102...) và một DB/schema test riêng (vd `app_test_p1_t03`).
5. **Commit trước khi spawn**: worktree tạo từ commit HEAD, thay đổi chưa commit agent sẽ không thấy.
6. Claude Code không hỗ trợ `isolation: "worktree"` cho sub-agent thì **không chạy song song**. Tự tạo worktree bằng tay không an toàn, vì lệnh của agent mặc định chạy ở checkout chính.

## 2. Spawn

1. Đổi `status: doing` cho các task của lượt và commit.
2. Gọi Agent tool cho từng task, **trong cùng một lượt gọi tool**:
   - `subagent_type`: `vibe:implementer` (hoặc `implementer` nếu agent được copy vào `.claude/agents/`).
   - `isolation: "worktree"` (agent `implementer` đã khai sẵn trong frontmatter; vẫn truyền khi gọi cho chắc).
   - Prompt theo [agent-brief.md](agent-brief.md): task card, bối cảnh tối thiểu, skill nên gọi, port và DB riêng, ranh giới, lệnh verify, format báo cáo.
3. Trong lúc agent chạy: đừng làm task của agent ở session chính. Trả lời hoặc chuyển cho user duyệt các lệnh xin quyền, chuẩn bị lượt sau.

## 3. Nhận kết quả (xử lý từng agent ngay khi xong)

1. Lấy worktree và branch **từ báo cáo** của agent (Claude Code tự đặt tên, vd `worktree-agent-...`), không đoán.
2. Agent báo BLOCKED vì thiếu quyền: nhờ user cấp quyền, rồi nhắn agent làm tiếp bằng SendMessage. Đừng tự làm thay. Thiếu thông tin: trả lời agent hoặc sửa task card rồi chạy lại.
3. Xem diff: `git diff phase/P1...<branch> --stat` rồi diff chi tiết; agent có sửa ngoài `touches` không, test có kiểm thật acceptance criteria không.
4. Verify **trong worktree của task** (vd `pnpm --dir <worktree> test`, `git -C <worktree> log`), không phải ở checkout chính. Tránh `cd` vì nó đổi thư mục làm việc của session chính.
5. Task rủi ro (auth, dữ liệu tenant, tiền, migration): đổi status sang `review`, chạy skill `review` với đường dẫn worktree và branch.
6. Merge: `git merge --no-ff <branch>`; conflict thì session chính tự giải quyết; chạy lại toàn bộ test ở checkout chính.
7. Cập nhật task card (`done`, branch/commit, tick acceptance criteria), xem ảnh chụp (task UI) rồi dọn: `git worktree remove <path>`, `git branch -d <branch>`.
8. Hết lượt: `tasks.py status`, cập nhật `docs/STATUS.md`, commit. Lượt sau quay lại mục 0: điều kiện chạy song song có thể không còn đúng.
