# Research kỹ thuật và đọc tài liệu tech stack

Kiến thức của model có ngày cắt, còn thư viện thì đổi liên tục (Next.js, Prisma, Tailwind, zod, React đều có bản major đổi API trong vài năm gần đây). Dùng API đã cũ hoặc không tồn tại là một trong những lỗi phổ biến nhất của vibe code. Quy tắc: **tài liệu khớp version đang cài là nguồn sự thật, không phải trí nhớ.**

## Khi nào phải làm

- Dùng thư viện, framework, dịch vụ hoặc API lần đầu trong dự án, hoặc chưa chắc cách dùng.
- Nâng cấp version major.
- Gặp lỗi kiểu "is not a function", "unknown option", type không khớp: thường là dùng API của version khác.
- Chọn giữa nhiều lựa chọn (thư viện, dịch vụ, kiến trúc).

## 1. Xác định version thật

- JS/TS: `package.json` và lockfile; `npm ls <gói>` hoặc `pnpm why <gói>` để xem version thực sự được cài.
- Python: `pyproject.toml`, `uv.lock`/`poetry.lock`, `pip show <gói>`. Go: `go.mod`. Ruby: `Gemfile.lock`.
- Dự án chưa có gì thì chọn version ổn định mới nhất và ghi vào note.

## 2. Đọc nguồn chính thức, theo thứ tự tin cậy

1. **Tài liệu chính thức đúng version** (WebFetch; nhiều trang có `/llms.txt`). Có MCP tra tài liệu (vd Context7) thì dùng.
2. **Migration guide và changelog** khi nâng version, hoặc khi ví dụ trên mạng là của version khác.
3. **Type definitions và source trong `node_modules`** (hoặc site-packages): đây là sự thật của đúng bản đang cài. Không chắc một hàm có tồn tại hay nhận tham số gì thì mở file `.d.ts` ra đọc.
4. GitHub issues/discussions cho lỗi lạ. Blog và Stack Overflow chỉ dùng sau cùng, và phải kiểm ngày đăng.

## 3. Chọn thư viện hoặc dịch vụ

| Tiêu chí | Câu hỏi |
|---|---|
| Còn được bảo trì | Release gần nhất? Issue có được trả lời? |
| Phù hợp stack | Hỗ trợ runtime, framework, TypeScript đang dùng? |
| Mức độ phổ biến | Lượt tải, cộng đồng, tài liệu? Càng phổ biến thì Claude càng ít đoán sai. |
| License | MIT/Apache thì thoải mái; GPL/AGPL thì kiểm với mô hình kinh doanh |
| Chi phí và lock-in | Giá khi tăng quy mô? Rời đi có dễ không? |
| Bảo mật và dữ liệu | Dữ liệu khách đi đâu (quan trọng với dịch vụ SaaS bên thứ ba)? |

Mặc định chọn phương án "nhàm chán" mà team đã quen. Ghi bảng so sánh và lý do chọn vào research note.

## 4. Spike khi còn chưa chắc

Spike là thử nghiệm nhanh có giới hạn thời gian, để trả lời **một** câu hỏi kỹ thuật (vd "Prisma có chạy được với RLS qua PgBouncer không?"):

- Làm trên branch `spike/<chủ-đề>`, đặt giới hạn (vd 1–2 giờ), code tối thiểu, không cần đẹp.
- Kết quả là câu trả lời + bằng chứng (lệnh, output), ghi vào research note. Code spike không merge thẳng vào sản phẩm.

## 5. Ghi lại để lần sau không phải tra lại

- `docs/research/<chủ-đề>.md` theo template RESEARCH.md: version, link tài liệu, đoạn quan trọng, ví dụ tối thiểu đã chạy được, các bẫy.
- Thêm 1–2 dòng vào mục "Ghi chú stack" trong `CLAUDE.md` (vd "Tailwind 4: cấu hình theme bằng CSS (`@theme`), mặc định không còn `tailwind.config.js`; xem docs/research/tailwind.md"). Mọi agent đều đọc CLAUDE.md nên đây là cách rẻ nhất để không lặp lại sai lầm.
