---
name: review
description: "Nghiệm thu trước khi merge một task hoặc chốt phase: chạy kiểm tra tự động trên đúng code của task, đối chiếu từng acceptance criteria với bằng chứng, nhờ verifier (sub-agent ngữ cảnh mới, chỉ đọc) soi diff theo checklist bảo mật, cô lập tenant, migration, xử lý lỗi, hiệu năng, UI, test; ra verdict PASS / PASS + follow-up / BLOCK và ghi docs/reviews/. Dùng khi user hỏi 'task này xong chưa', 'review task P1-T03', 'chốt phase', 'sẵn sàng merge chưa', hoặc sau khi build xong task rủi ro (auth, dữ liệu tenant, tiền, migration). Đoạn code rời thì chỉ dùng checklist."
---

# Review: nghiệm thu có bằng chứng

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Checklist: `${CLAUDE_SKILL_DIR}/references/checklist.md`.

"Xong" nghĩa là có bằng chứng, không phải vì người viết code (kể cả chính bạn) nói là xong.

## Cân đúng mức

- **Đoạn code rời, PR nhỏ không gắn task card**: review theo checklist, trả lời trong chat. Bỏ qua bước 1 và 3, không ghi file.
- **Task rủi ro thấp**: tự soát theo checklist + bước 1, 2.
- **Task rủi ro (auth, dữ liệu tenant, tiền, migration) và chốt phase**: đủ 5 bước.

## Phạm vi và nơi chạy

- **Task**: code nằm trên branch của task (`task/<ID>`, hoặc branch trong worktree của sub-agent, lấy từ báo cáo hay `git worktree list`; đừng đoán tên). Diff: `git diff phase/P1...<branch>`. Lệnh kiểm tra chạy **ở nơi có code đó**: đang checkout branch đó, hoặc trỏ vào worktree (`pnpm --dir <worktree> test`). Chạy ở branch phase thì sẽ pass mà chưa hề chạm tới code của task.
- **Phase**: `git diff main...phase/P1` + exit criteria trong `PHASES.md` + các task card của phase.

## Bước 1: Kiểm tra tự động

Chạy lệnh trong `CLAUDE.md`: typecheck, lint, test, build; có migration mới thì chạy thử trên DB trống và DB có dữ liệu mẫu. Ghi lệnh và kết quả. Fail thì verdict là BLOCK, dừng lại và báo lỗi cụ thể.

## Bước 2: Đối chiếu acceptance criteria

Mỗi tiêu chí (hoặc exit criteria của phase) cần một bằng chứng: tên test, output lệnh, ảnh chụp, kết quả query. Không có bằng chứng thì tính là chưa đạt, dù code trông đúng.

## Bước 3: Verifier độc lập

Spawn sub-agent `verifier` (cài dạng plugin là `vibe:verifier`; chỉ đọc, không sửa). Đưa cho nó: lệnh diff, đường dẫn nơi có code (worktree hoặc branch), task card hoặc `PHASES.md`, và đường dẫn checklist ở trên. Test của dự án cần DB hoặc port: đưa thêm `DATABASE_URL` và port riêng, không trùng với agent nào đang chạy (test reset DB của nhau sẽ fail hoặc pass sai).

Đưa code và yêu cầu, **không đưa kết luận của bạn**: verifier tách ngữ cảnh chính là để không bị neo vào cách nghĩ của người viết. Diff nhỏ, rủi ro thấp thì tự review theo checklist là đủ.

## Bước 4: Phân loại và ra verdict

Gộp phát hiện, bỏ trùng; phát hiện nghiêm trọng thì tự mở code kiểm lại trước khi tin.

| Mức | Gồm |
|---|---|
| 🔴 Chặn | Rò dữ liệu giữa tenant, lỗ hổng auth/authz, mất hoặc hỏng dữ liệu, migration nguy hiểm, acceptance criteria chưa đạt, test fail |
| 🟡 Nên sửa trước khi merge | Xử lý lỗi sai, thiếu test cho nhánh quan trọng, N+1, query mới thiếu index, UI lệch design rõ ràng |
| 🔵 Gợi ý | Đặt tên, refactor nhỏ, tài liệu |

- **PASS**: không có 🔴 hay 🟡.
- **PASS + follow-up**: chỉ có 🟡 nhỏ và user đồng ý làm sau; tạo task card cho từng mục.
- **BLOCK**: có 🔴, hoặc 🟡 mà user muốn sửa ngay.

## Bước 5: Ghi báo cáo → `docs/reviews/<ID>.md`

```markdown
# Review P1-T03: BLOCK
Ngày: YYYY-MM-DD · Diff: phase/P1...task/P1-T03

## Kiểm tra tự động
| Lệnh | Kết quả |
|---|---|
| pnpm typecheck | ✅ |
| pnpm --filter api test | ❌ customers.isolation › PATCH chéo tenant |

## Acceptance criteria
| Tiêu chí | Bằng chứng | Đạt |
|---|---|---|
| Đọc/sửa id của tenant khác → 404 | customers.isolation.test.ts | ❌ PATCH trả 200 |

## Phát hiện
### 🔴 PATCH /v1/t/{tenantId}/customers/{id} sửa được khách của tenant khác
- apps/api/src/modules/customers/repo.ts:42: update theo id, không qua transaction có tenant context
- Kịch bản: user của tenant A gửi `PATCH /v1/t/<A>/customers/<id khách của B>` → bản ghi của B bị sửa
- Sửa: dùng withTenant() như các hàm đọc; thêm case vào test bảng
```

Cập nhật task card (status, link báo cáo) và `docs/STATUS.md`. PASS thì quay lại skill `build` để merge. BLOCK thì sửa trên chính branch đó rồi chạy lại. Đừng hạ mức một phát hiện chỉ để cho qua.
