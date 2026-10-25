# Đóng góp cho vibe

Cảm ơn bạn muốn làm bộ skill tốt hơn. Người dùng sẽ làm theo những gì skill viết để xây phần mềm thật, nên tiêu chuẩn ở đây là **đúng trước, gọn sau**.

## Nguyên tắc

1. **Ví dụ phải chạy được.** Mọi đoạn code, SQL, YAML, lệnh shell thêm vào tài liệu phải được chạy thử trên version cụ thể (ghi version trong PR). SQL chạy trên PostgreSQL thật bằng đúng role mà tài liệu nói tới (role app không phải superuser). Workflow GitHub Actions qua `actionlint`. TypeScript qua `tsc --strict`.
2. **Test phải bắt được lỗi.** Ví dụ test (cô lập tenant, Playwright...) cần được chạy cả trên bản code đúng lẫn bản cố ý cài lỗi, và fail ở bản lỗi.
3. **Giữ một agent chính.** Đừng thêm sub-agent cho việc mà session chính làm được. Sub-agent chỉ cho kiểm chứng độc lập, chạy song song việc lớn và độc lập, hoặc đọc một lượng lớn tài liệu/code mà chỉ cần kết luận (giữ context chính gọn).
4. **Nạp khi cần.** `SKILL.md` chỉ gồm: khi nào dùng, bảng chọn file tài liệu, vài quy tắc luôn áp dụng, phần "cân đúng mức". Chi tiết để trong `references/`; file trên 100 dòng có mục lục. Mô tả skill (`description`) dưới 1024 ký tự, không có dấu `<` `>`.
5. **Viết tiếng Việt rõ ràng.** Giữ thuật ngữ tiếng Anh khi đó là tên gọi phổ biến (migration, rollback, worktree). Không viết kiểu marketing; nói điều cần làm và vì sao.
6. **Không đoán API.** Thư viện đổi nhanh: kiểm tài liệu đúng version trước khi viết, và ghi rõ khi một chi tiết phụ thuộc version.

## Trước khi mở PR

```bash
claude plugin validate ./plugins/vibe
python3 plugins/vibe/skills/tasks/scripts/tasks.py check --dir plugins/vibe/skills/tasks/examples/mini-crm
```

- Sửa hành vi của một skill: thêm hoặc cập nhật case trong `plugins/vibe/evals/`, chạy `claude plugin eval` có và không có thay đổi, ghi kết quả vào PR.
- Sửa `tasks.py` hoặc ví dụ mini-crm: chạy lại `python3 assets/make_graphics.py` để hình terminal trong README khớp output thật.
- Tăng `version` trong `plugins/vibe/.claude-plugin/plugin.json` khi phát hành.

## Báo lỗi

Mở issue kèm: skill nào, câu bạn đã nói với Claude, Claude đã làm gì, bạn mong đợi gì. Lỗi trong ví dụ code thì kèm version và output lỗi. Lỗ hổng bảo mật trong hướng dẫn (vd policy RLS để lọt dữ liệu) thì ghi rõ kịch bản tấn công.
