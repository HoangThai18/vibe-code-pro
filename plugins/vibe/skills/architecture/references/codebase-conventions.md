# Theo đúng quy ước của codebase

Mục tiêu: code mới khớp với code cũ tới mức người đọc không nhận ra đâu là phần AI viết. Code "đúng" nhưng lạ kiểu với phần còn lại vẫn là nợ: người sau phải hiểu hai cách làm, và hai cách đó sẽ dần lệch nhau.

## Mục lục
1. Khảo sát codebase lần đầu
2. Ghi lại quy ước
3. Khi viết code mới
4. Khi codebase không nhất quán
5. Khi pattern hiện có là sai
6. Code cũ (legacy)
7. Checklist cuối

## 1. Khảo sát codebase lần đầu (10–20 phút, làm một lần)

- Đọc `README`, `CLAUDE.md`, `docs/`, file cấu hình (package.json/pyproject, tsconfig, eslint/prettier, CI).
- Cấu trúc thư mục: chia theo tính năng (`modules/customers/...`) hay theo tầng (`controllers/`, `services/`...)? Monorepo có những package nào, phụ thuộc nhau ra sao?
- Chạy bộ test và lint hiện có **trước khi sửa gì**, để biết trạng thái ban đầu (test nào vốn đã fail thì không phải do mình).
- Lần theo **một request hoàn chỉnh**: route → middleware (auth, tenant) → handler/controller → service → repository/ORM → DB → format response và lỗi. Đây là xương sống mà mọi tính năng mới phải bám theo.
- Codebase lớn: tìm định nghĩa và mọi chỗ gọi theo symbol (công cụ `LSP` khi dự án có LSP plugin) chắc hơn grep theo chữ, nhất là trước khi đổi tên hay đổi chữ ký hàm. Cài: skill `plan`, `references/dev-tools.md` mục 9 (từ file này: `../../plan/references/dev-tools.md`).
- Tìm quy ước ở từng mặt:

| Mặt | Câu hỏi |
|---|---|
| Đặt tên | file (kebab, camel, `.service.ts`?), hàm, class, biến, bảng, cột, route |
| Cấu trúc module | file nào có trong một module, export gì ra ngoài |
| Dependency injection | constructor, container (NestJS, tsyringe), module-level singleton, tham số hàm |
| Validate | ở đâu (route schema, DTO, service), bằng gì (zod, class-validator, pydantic) |
| Lỗi | class lỗi riêng có `code`? Result type? Lỗi map sang HTTP ở đâu? |
| Truy cập dữ liệu | repository riêng hay gọi ORM thẳng trong service? transaction mở ở tầng nào? |
| Log, config | logger nào, đọc config từ đâu |
| Test | để ở đâu, framework nào, factory/fixture ra sao, mock những gì |
| Frontend | cấu trúc component, styling, data fetching, state, form |
| Format và lint | formatter (Prettier, Black, gofmt), linter, pre-commit hook (husky, lint-staged, pre-commit); chạy đúng lệnh của dự án thay vì tự format theo ý mình |
| Import | path alias (`@/`), import tương đối hay tuyệt đối, thứ tự import, barrel file (`index.ts`) |
| Code sinh tự động | Prisma client, client OpenAPI, GraphQL types, file migration: **không sửa tay**, sửa nguồn rồi chạy lệnh generate |
| Ngôn ngữ | tên biến, comment, message lỗi, commit viết tiếng Việt hay tiếng Anh |
| Mức chặt của type | `strict`, có cho dùng `any` không, cách xử lý null |

## 2. Ghi lại quy ước

Đề xuất 10–20 dòng cho mục "Quy ước" của `CLAUDE.md`, kèm đường dẫn tới một module mẫu, để user duyệt rồi mới ghi. Chỉ session chính sửa `CLAUDE.md`; sub-agent đưa đề xuất vào báo cáo, không tự sửa, để các agent chạy song song không cùng ghi một file. Chỉ ghi những gì không tự suy ra được từ code. Ví dụ:

```markdown
## Quy ước
- Module theo tính năng: `src/modules/<tên>/{<tên>.routes.ts, <tên>.service.ts, <tên>.repository.ts, <tên>.schema.ts}`. Mẫu chuẩn: `src/modules/customers/`.
- Lỗi nghiệp vụ: `throw new AppError('customer_email_taken', 409)` từ `src/shared/errors.ts`; route không tự bắt lỗi, middleware chung lo.
- Validate input bằng zod schema trong `<tên>.schema.ts`, dùng lại ở FE qua `packages/contracts`.
- Repository nhận `tx` làm tham số đầu; service mở transaction bằng `withTenant()`.
- Test: `*.test.ts` cạnh file nguồn; dữ liệu qua `test/factories`; không mock repository trong test service, dùng DB test.
```

Mọi agent đều đọc `CLAUDE.md`, nên ghi một lần là cả team và mọi phiên sau dùng được.

## 3. Khi viết code mới

- **Tìm tính năng gần giống nhất** và theo cách nó làm: bố cục file, chữ ký hàm, cách đặt tên, kiểu test. Làm "supplier" thì nhìn "customer"; làm màn danh sách thì nhìn màn danh sách đã có.
- **Dùng đúng thư viện đang dùng** cho cùng việc. Muốn thêm thư viện mới thì hỏi user và nêu lý do.
- **Dùng lại hạ tầng chung**: error class, logger, config, HTTP client, component UI, hàm format tiền và ngày. Grep trước khi viết helper mới.
- **Giữ ranh giới (nếu codebase đã chia module có ranh giới)**: cần dữ liệu của module khác thì gọi API công khai của module đó, không query thẳng bảng của nó. Cần nhiều bản ghi thì dùng (hoặc thêm) hàm đọc theo lô, không gọi từng cái trong vòng lặp; thao tác phải nằm chung transaction thì truyền `tx` vào. Codebase theo kiểu Rails/Django mà join giữa các app bằng ORM là quy ước thì theo quy ước đó.
- **Test theo đúng kiểu đang có** (vị trí file, cách tạo dữ liệu, mức mock).

## 4. Khi codebase không nhất quán

- Có hai cách cùng tồn tại, chọn theo thứ tự: (1) hướng đã được ghi trong `CLAUDE.md`, ADR hay tài liệu migration của dự án; (2) cách **mới hơn** (xem `git log`), vì thường là hướng team đang chuyển tới; (3) vẫn không rõ thì hỏi user một câu, kèm hai lựa chọn cụ thể.
- Module mới hoàn toàn: theo module gần nhất về chức năng.
- Không sửa đồng loạt các chỗ cũ trong task hiện tại; ghi nhận và đề xuất task dọn dẹp riêng.

## 5. Khi pattern hiện có là sai

Pattern có lỗi thật (lỗ hổng bảo mật, thiếu tenant scope, thiếu transaction cho thao tác cần nguyên tử, N+1, nuốt lỗi) thì **không chép lỗi đó sang chỗ mới**. Viết đúng ở phần mình làm, báo user chỗ cũ có vấn đề, đề xuất task sửa. Đây là mục 0 trong thứ tự ưu tiên của SKILL.md: bảo mật và tính đúng luôn đứng trên sự nhất quán.

## 6. Code cũ (legacy)

- Trước khi sửa phần không có test: viết **characterization test** ghi lại hành vi hiện tại, kể cả hành vi lạ, để biết mình có làm thay đổi gì không.
- Thay đổi theo bước nhỏ, mỗi bước commit được và test pass.
- Viết lại phần lớn thì dùng strangler: làm phần mới bên cạnh, chuyển dần luồng sang, xoá phần cũ khi không còn ai dùng. Không viết lại toàn bộ một lần.
- Tách commit refactor (không đổi hành vi) khỏi commit tính năng, để review và revert dễ.

## 7. Checklist cuối

- [ ] File mới nằm đúng chỗ, đặt tên giống các file cùng loại
- [ ] Dùng lại error class, logger, helper, component có sẵn; không thêm thư viện trùng chức năng
- [ ] Logic nghiệp vụ nằm ở tầng nghiệp vụ, không ở controller, component hay SQL rải rác
- [ ] Không import ngược chiều hay vòng tròn; không đọc thẳng bảng của module khác
- [ ] Test cùng kiểu với test đang có
- [ ] Không sửa tay code sinh tự động; import và path alias đúng kiểu dự án
- [ ] Lint, format, typecheck pass theo cấu hình dự án; test đang pass trước khi sửa vẫn pass
