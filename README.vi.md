<p align="center">
  <img src="assets/hero.svg" width="100%" alt="vibe: bộ Agent Skills để làm ra phần mềm thật. 12 skill: plan, tasks, architecture, backend, frontend, mobile, desktop, ai, build, review, ship, fix. Dùng được với Claude Code, Codex, Cursor, Copilot, Gemini CLI, OpenCode.">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-7C3AED?style=flat-square"></a>
  <a href="https://agentskills.io"><img alt="Chuẩn Agent Skills" src="https://img.shields.io/badge/Agent%20Skills-standard-0891B2?style=flat-square"></a>
  <img alt="12 skill, 5 lệnh, 2 subagent" src="https://img.shields.io/badge/skills-12%20·%20lệnh%205%20·%20subagents%202-DB2777?style=flat-square">
  <img alt="Ví dụ đã chạy thật" src="https://img.shields.io/badge/ví%20dụ-đã%20chạy%20thật-059669?style=flat-square">
  <a href="#eval-có-và-không-có-skill"><img alt="Eval: 0.98 có skill, 0.80 không có, 26 case" src="https://img.shields.io/badge/eval-0.98%20có%20skill%20·%200.80%20không-F59E0B?style=flat-square"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>Tiếng Việt</b></p>

Vibe code thì nhanh, nhưng phần mềm chạy thật cần thêm nhiều thứ prompt hay bỏ quên: hiểu đúng nghiệp vụ, test đi cùng code, dữ liệu khách này không lộ sang khách kia, migration không làm sập bản đang chạy, có đường rollback, backup đã restore thử. **vibe** gói những kinh nghiệm đó thành 12 [Agent Skills](https://agentskills.io) cho web, app mobile (iOS, Android), app desktop (Windows, macOS, Linux) và tính năng AI. Agent tự chọn đúng skill theo câu bạn nói, và chỉ đọc phần tài liệu cần cho việc đang làm.

Nội dung skill viết bằng tiếng Anh để agent nào cũng hiểu như nhau và tốn ít token hơn. Agent vẫn trả lời bạn bằng tiếng Việt, và tài liệu dự án (PRD, task card...) viết theo ngôn ngữ bạn dùng. Dùng được với mọi agent hỗ trợ chuẩn mở Agent Skills: Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Cline, Goose, Roo Code, Amp, Windsurf...

## Cài đặt

**Mọi agent** (trình cài [`skills`](https://github.com/vercel-labs/skills) chép skill vào thư mục của từng agent):

```bash
npx skills add HoangThai18/vibe-code-pro
```

**Plugin cho Claude Code** (có thêm hai subagent; Claude Code 2.1.275 trở lên):

```bash
claude plugin install vibe --marketplace HoangThai18/vibe-code-pro
```

**Chép tay**: chép `plugins/vibe/skills/*` vào thư mục agent của bạn đọc.

| Agent | Thư mục trong dự án | Thư mục của user | Gọi lệnh |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | `/vibe-start` |
| OpenAI Codex | `.agents/skills/` | `~/.agents/skills/` | `$vibe-start` |
| Cursor | `.agents/skills/` hoặc `.cursor/skills/` | `~/.cursor/skills/` | `/vibe-start` |
| GitHub Copilot (VS Code, CLI) | `.github/skills/` hoặc `.agents/skills/` | `~/.copilot/skills/` | `/vibe-start` |
| Gemini CLI | `.agents/skills/` hoặc `.gemini/skills/` | `~/.gemini/skills/` | nói: "dùng vibe-start" |
| OpenCode | `.agents/skills/` hoặc `.opencode/skills/` | `~/.config/opencode/skills/` | nói: "dùng vibe-start" |
| Cline, Goose, Roo Code, Amp, Windsurf | `.agents/skills/` | `~/.agents/skills/` | `/vibe-start` (Windsurf: `@vibe-start`) |
| Kiro, Junie, Factory | `.kiro/skills/`, `.junie/skills/`, `.factory/skills/` | tương tự trong `~/` | `/vibe-start` |

```bash
git clone https://github.com/HoangThai18/vibe-code-pro
mkdir -p .agents/skills && cp -r vibe-code-pro/plugins/vibe/skills/* .agents/skills/
```

Cài đủ bộ: các skill gọi nhau bằng tên (`vibe-backend`, `vibe-tasks`...). Hướng dẫn cho agent của dự án nằm trong `AGENTS.md`; skill plan tạo thêm `CLAUDE.md` một dòng (`@AGENTS.md`) vì Claude Code đọc file đó.

## Lệnh nhanh

| Gõ | Để làm gì |
|---|---|
| `/vibe-start <ý tưởng>` | Dự án mới: làm rõ yêu cầu, phân tích nghiệp vụ, lên plan, chia task. Dự án có sẵn: khảo sát code, tạo `AGENTS.md`, chia task |
| `/vibe-status` | Tới đâu rồi: tiến độ, task đang làm, task bị chặn, việc nên làm tiếp |
| `/vibe-next [P1-T03]` | Làm việc tiếp theo (hoặc đúng task đó): code kèm test, rồi dừng ở bước review (giữ nhánh, chưa merge) |
| `/vibe-check [P1-T03 \| phase P1]` | Review có bằng chứng: test, acceptance criteria, verifier độc lập. PASS thì merge và đánh dấu done; BLOCK thì liệt kê chỗ cần sửa |
| `/vibe-fix <mô tả lỗi>` | Sửa bug, xử lý sự cố |
| `/vibe-ship <việc>` | Deploy, rollback, backup, giám sát |
| `/vibe-help` | Bảng lệnh và gợi ý lệnh nên dùng theo trạng thái dự án |

Một vòng: `/vibe-start` → `/vibe-next` (dừng ở review) → `/vibe-check` (PASS thì merge) → `/vibe-next`. Hết task của một phase thì `/vibe-check phase P1` để chốt phase, lần `/vibe-next` sau sẽ chia task cho phase kế tiếp. Hoặc cứ nói bình thường: *"phân tích nghiệp vụ app đặt lịch spa"*, *"tới đâu rồi?"*, *"làm tiếp"*, *"lỗi 500 khi tạo khách"*.

**Nâng cấp từ 0.x**: mọi skill giờ có tiền tố `vibe-` (`/vibe:start` → `/vibe-start`, `/vibe:check` → `/vibe-check`) và được viết bằng tiếng Anh. Dự án mới dùng `AGENTS.md`; `CLAUDE.md` đang có được giữ nguyên và thêm dòng `@AGENTS.md`. Task card và `docs/` không cần đổi. Cập nhật bằng `claude plugin update vibe`, hoặc chạy lại `npx skills add HoangThai18/vibe-code-pro`.

## Quy trình

<p align="center">
  <img src="assets/flow.svg" width="100%" alt="Ý tưởng → plan → tasks → build → review → ship → chạy thật. Build dùng các skill architecture, backend, frontend, mobile, desktop, ai. Có lỗi thì qua fix rồi quay lại tasks.">
</p>

Theo hướng Anthropic khuyến nghị cho agent: **một agent chính + skills + tools**. Kiến thức nằm trong skill và chỉ nạp khi cần; subagent chỉ dùng khi đáng (review độc lập, chạy song song việc lớn và độc lập). Mỗi phiên chỉ mang theo mô tả ngắn của skill: khoảng **3.6k token** theo ước tính của `claude plugin details`, con số này tính cả khoảng 340 token của 5 lệnh nhanh. Trên các agent hỗ trợ `disable-model-invocation` (Claude Code, VS Code Copilot, Cursor), các lệnh không nằm trong context cho tới khi bạn gõ; Codex cũng vậy nhờ file `agents/openai.yaml` của mỗi lệnh.

| Skill | Lo phần | Tài liệu nạp khi cần |
|---|---|---|
| `vibe-plan` | Làm rõ yêu cầu, phân tích nghiệp vụ, research người dùng / đối thủ / tech stack, PRD, kiến trúc, chia phase, công cụ cho agent (Context7, Playwright, Chrome DevTools, Figma, Supabase, GitHub, LSP) | domain-analysis, tech-research, dev-tools, 6 template |
| `vibe-tasks` | Task card có deps và file sẽ đụng, tiến độ, việc tiếp theo, làm tiếp từ handoff ("làm tiếp đi") | split, `tasks.py`, template, ví dụ mini CRM |
| `vibe-architecture` | Code theo đúng quy ước của codebase; chọn kiến trúc hợp với yêu cầu (modular monolith, layered, hexagonal, DDD, CQRS, event, microservices); SOLID, pattern, refactor | codebase-conventions, architecture-styles, ddd, design-principles |
| `vibe-backend` | Schema, index, transaction, migration an toàn, 8 ORM, multi-tenant + Postgres RLS, API contract, xác thực, **mô hình phân quyền** (vai trò cố định, vai trò mỗi spa tự tạo, ma trận theo module, phạm vi chi nhánh), đăng nhập cho app native, job nền, bảo mật ứng dụng, dữ liệu cá nhân theo luật Việt Nam, **thanh toán** (VNPay, MoMo, VietQR, hoá đơn điện tử), **tìm kiếm tiếng Việt**, **gửi email/Zalo/SMS**, **realtime**, **nhập Excel/CSV** | data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, native-auth, permissions, jobs, app-security, privacy, payments, search, notifications, realtime, data-import |
| `vibe-frontend` | Web: UI theo mockup (Claude Design, Figma), motion, state (TanStack Query, Zustand, Redux, Pinia...), đổi workspace an toàn, **Next.js Server Actions** và `'use cache'` theo tenant, **đa ngôn ngữ** (VND, múi giờ, số nhiều), **SEO trang công khai** | design-to-code, motion-spec, state-management, server-actions, i18n, seo |
| `vibe-mobile` | iOS và Android: chọn stack (Expo/React Native, Flutter, native, PWA), token trong Keychain/Keystore, hàng đợi ghi offline, push, deep link, test (Jest, Maestro), EAS Build, OTA, duyệt store, buộc cập nhật | choose-stack, app-data, platform-features, testing, release |
| `vibe-desktop` | Windows, macOS, Linux: Tauri / Electron / PWA, bảo mật Electron (isolation, sandbox, IPC kiểm nguồn gửi), token qua kho khoá hệ điều hành, test Playwright, ký số, notarize, tự cập nhật | choose-stack, security, app-data, testing, release |
| `vibe-ai` | Tính năng AI trong app: gọi Claude API từ server, structured output, streaming, chống prompt injection, cô lập tenant, ngân sách và usage theo tenant, lịch sử chat, đọc ảnh và PDF, test không tốn tiền, eval chất lượng | design, integration, safety, cost, chat-and-files, testing |
| `vibe-build` | Một agent làm cả code lẫn test cho từng task, chọn mức test, **test giao diện và luồng người dùng bằng Playwright**, khi nào mới chạy song song | testing, e2e-playwright, parallel, agent-brief |
| `vibe-review` | Nghiệm thu có bằng chứng, verifier độc lập, PASS / PASS kèm việc sau / BLOCK; PASS thì merge task | checklist, verifier · template REVIEW |
| `vibe-ship` | CI/CD, deploy kèm migration đúng thứ tự, feature flag, **rollback**, giám sát, **backup và restore**, bảo trì, **hiệu năng và kiểm tải** (k6, query chậm, Web Vitals) | ci-cd, release-rollback, observability, backup-restore, maintenance, performance |
| `vibe-fix` | Sửa bug bằng test tái hiện trước, sự cố production, nghi lộ dữ liệu, postmortem | template POSTMORTEM |

| Subagent | Khi nào dùng |
|---|---|
| `vibe-verifier` | Review độc lập: ngữ cảnh mới, chỉ đọc, chạy kiểm tra và soi diff mà không bị neo vào cách nghĩ của người viết code. Agent không có subagent thì skill review dùng một phiên mới thay thế |
| `vibe-implementer` | Chỉ khi chạy song song nhiều task **lớn và độc lập**, mỗi task một git worktree. Mặc định phiên chính tự làm |

## Tiến độ nằm trong repo, không nằm trong trí nhớ của chat

<p align="center">
  <img src="assets/terminal.svg" width="90%" alt="Output thật của tasks.py status và next trên dự án mẫu mini-crm: tiến độ theo phase, task đang làm, task sẵn sàng, task chờ deps.">
</p>

Task card là file Markdown trong `docs/tasks/`, nên phiên nào, máy nào cũng làm tiếp được. `tasks.py` (Python 3.8+, không cần cài thêm) kiểm lỗi deps, xếp thứ tự (review trước, rồi tới phase thấp nhất còn việc), không bao giờ cho hai task cùng sửa một file hay hai migration schema chạy cùng lúc, báo lỗi card thì thoát mã 1, và gợi ý đúng một việc tiếp theo. 49 unit test chạy trong CI trên Python 3.8 và 3.12:

```bash
S=plugins/vibe/skills/vibe-tasks
python3 $S/scripts/tasks.py status --dir $S/examples/mini-crm
python3 $S/scripts/tasks.py next   --dir $S/examples/mini-crm
```

## Đã chạy thật, không chỉ viết ra

Tài liệu cho phần mềm thật mà ví dụ sai thì còn hại hơn không có. Code, SQL, workflow được chạy thử trước khi đưa vào. Từ bản 1.2.0, code đó nằm trong [`verify/`](verify/) cùng test, và CI chạy lại ở mỗi pull request trên một PostgreSQL 16 trống: 13 project, cộng app Expo và app Electron. 29 tài liệu tham khảo được sinh ra từ chính các file đã test, nên tài liệu và code lệch nhau là CI báo lỗi.

| Phần | Cách kiểm | Kết quả |
|---|---|---|
| **Backend lõi (1.2.0)**: worker liệt kê tenant, bảng chỉ ghi thêm, kiểm membership, đổi vai trò, API key, token cho app native, Idempotency-Key, chống đặt trùng lịch, các mô hình phân quyền | vitest + Express 5 trên PostgreSQL 16 (`FORCE` RLS), request chạy đồng thời | 77 test; phát hiện dưới `FORCE` RLS câu `SELECT id FROM tenants` của worker trả 0 dòng (job nhắc lịch lặng lẽ không làm gì), và hai owner cùng lúc hạ quyền nhau thì không còn owner nào cho tới khi khoá dòng owner; 21 lớp chặn, bỏ cái nào cũng có test fail |
| Multi-tenant SQL: RLS, policy đọc/ghi tách riêng, composite FK, kiểm membership theo request, tra workspace trước đăng nhập, Supabase | Chạy nguyên văn trên PostgreSQL 16 bằng role app, kèm phép thử tấn công chéo tenant | Chặn đúng. Đã sửa hai lỗ của bản nháp: policy có `OR` cho ghi chéo tenant, và bảng slug ghi được bằng role app |
| Backup và restore | `pg_dump` bằng role backup, restore sang cluster mới bằng admin không phải superuser, kiểm owner, RLS, số dòng, migration tiếp theo | 0 lỗi; bắt được 2 lỗi thật của tài liệu cũ |
| Test giao diện Playwright | 21 test, lặp 5 lần × 4 worker, trên app thường, app huỷ request khi đổi trang, app có `role="alert"` kiểu Next.js | Không chập chờn; hai test đổi workspace fail mọi lần trên hai bản app cố ý cài lỗi |
| Test cô lập tenant | Trên app đúng và 3 bản lỗi | Bắt được cả 3; phần đối chứng bắt được test "pass mà không kiểm gì" |
| 8 ORM | "Trừ kho + tạo đơn" trên PostgreSQL 16: còn hàng, hết hàng, hai transaction tranh nhau | Đạt cả 8; bắt được lỗi bán vượt tồn ở bản nháp |
| Ví dụ TypeScript (DDD, state, auth, webhook, `426 app_update_required`) | `tsc --strict` + unit test | Đạt |
| App mobile Expo SDK 58 | `tsc --strict`, Jest khi chưa có cache, `eas.json` qua bộ đọc cấu hình của `eas-cli`, runtime version theo biến thể | Đạt; bắt được lỗi bản nháp (type TypeScript 6, Jest không thoát, quá giờ khi chưa có cache, quy trình OTA sai). 1.2.0: hàng đợi ghi offline giữ lại bản ghi khi gặp 401 và 426 (trước đây xoá mất), thiết bị nhận push gửi theo membership; 30 test Jest và một test SQL, chạy trong CI |
| App desktop: bảo mật Electron, `safeStorage`, Tauri | Electron 45 + Playwright 1.64 (100 lượt liên tiếp) trên app mẫu và 8 bản cố ý cấu hình sai; build Tauri 2.12 thật | Bắt được cả 8; bắt được lỗi bản nháp. 1.2.0: không có permission handler thì Electron 45 cấp camera và mọi quyền khác; `new URL('app://…').origin` là `'null'` nên lớp chặn điều hướng chặn luôn trang của chính app. Test Electron chạy trong CI |
| Tính năng AI | `@anthropic-ai/sdk` 1.3 với fetch giả, `tsc --strict`, bảng usage trên PostgreSQL 16, bỏ từng lớp bảo vệ | 24 test; 15 lớp chặn, bỏ cái nào cũng có test fail; phát hiện phần ghi usage đọc bảng `tenants` ngoài context tenant, nên dưới `FORCE` RLS mọi lượt gọi AI đều bị chặn. Eval gọi API thật chưa chạy (môi trường kiểm không có API key) |
| Job nền pg-boss | pg-boss 12.38 trên PostgreSQL 16 có RLS `FORCE`, worker thật | 9 test; worker liệt kê tenant qua `app_tenant_ids()`; 6 lớp bảo vệ bị bỏ đều có test fail |
| Hiệu năng | k6 1.8.2 vào API mẫu 500.000 khách; Playwright + `web-vitals` 6 | Index đúng: p95 từ 2,74 giây xuống 1,97 ms; test ngân sách bắt được trang CLS 0,23 |
| Bảo mật ứng dụng | Node 22, PostgreSQL 16, gitleaks 8.30 | 15 test, có cả hộp mã hoá bí mật của tenant; bỏ lớp chặn SSRF nào cũng có test fail; rate limit đúng 10/50; gitleaks bắt key giả kể cả khi file đã xoá |
| Dữ liệu cá nhân | PostgreSQL 16 có RLS; test hàm tính hạn | 6 test; phát hiện view thiếu `security_invoker` làm lộ dữ liệu giữa tenant; nhật ký đồng ý chỉ ghi thêm (`REVOKE`) |
| Thanh toán: VNPay, MoMo, webhook chuyển khoản, hoàn tiền | So cách ký với code mẫu chính thức của VNPay và MoMo; xử lý IPN và webhook SePay trên PostgreSQL 16 bằng role của app, có callback trùng chạy đồng thời | 30 test; 17 lớp chặn, bỏ cái nào cũng có test fail (khoá dòng, kiểm số tiền, `07` chuyển sang chờ duyệt, ký tự kiểm tra trong mã chuyển khoản, hỏi `querydr` trước khi gửi lại lệnh hoàn tiền...); phát hiện cộng tiền hoàn ngay trong câu lệnh khoá dòng thì chấp nhận hoàn 300.000 VND cho khoản thanh toán 200.000 VND. Chưa chạy với sandbox thật của VNPay, MoMo (không có tài khoản merchant) |
| Tìm kiếm tiếng Việt: tên không dấu, số điện thoại, ghi chú | PostgreSQL 16 với 500.000 khách, đo bằng role của app | Phát hiện dưới RLS `LIKE` không dùng được index trigram (380 ms với spa 200.000 khách); hàm tìm `SECURITY DEFINER` mất 2–25 ms. 13 test; 9 lớp chặn, bỏ cái nào cũng có test fail |
| Gửi tin: huỷ đăng ký một chạm, làm mới token Zalo, giới hạn tin quảng cáo, số phần SMS | PostgreSQL 16, Zalo giả lập có xoay vòng refresh token | 9 test; ba lần làm mới đồng thời chỉ dùng refresh token một lần; ba chiến dịch cùng lúc sau khi đã gửi hai tin: chỉ thêm đúng một tin; 8 lớp chặn, bỏ cái nào cũng có test fail. Chưa gửi qua Zalo hay nhà mạng thật |
| Realtime: SSE, LISTEN/NOTIFY, client TanStack Query | Hai instance app trên PostgreSQL 16 (`FORCE` RLS), stream HTTP thật, client jsdom | 22 test; ghi bị rollback không phát sự kiện; sự kiện tenant A không tới B; 12 lớp chặn, bỏ cái nào cũng có test fail |
| Đa ngôn ngữ: VND, giờ theo múi giờ tenant, file dịch, sắp xếp tiếng Việt | ICU của Node 22, PostgreSQL 16, next-intl 4.14 + Next.js 16 trên Chromium ở 3 múi giờ | 30 test; phát hiện `1.250.000 ₫` dùng dấu cách không ngắt, Postgres đọc `'GMT+7'` thành UTC−7, định dạng thiếu múi giờ làm lỗi hydration; 11 lớp chặn, bỏ cái nào cũng có test fail |
| Nhập Excel/CSV | exceljs 4.4 và csv-parse 7 trên file .xlsx và CSV thật, pg-boss 12.38, tắt ngang worker giữa chừng | 21 test; nhập lại không tạo bản trùng, email đã có người dùng không còn làm kẹt cả lô; phát hiện đọc `columnCount` của exceljs mỗi dòng làm 50.000 dòng mất 432 giây, và `delimiter_auto` của csv-parse hỏng với chữ tiếng Việt; 7 lớp chặn, bỏ cái nào cũng có test fail |
| Next.js Server Actions và `'use cache'` theo tenant (1.2.0) | `next build` + `next start`, gọi action qua HTTP | 4 test; phát hiện hàm `'use cache'` cũng là một server function: gọi thẳng với id của tenant khác thì trả về khách của tenant đó; 5 lớp chặn, bỏ cái nào cũng có test fail |
| SEO trang công khai | `next build` + `next start` (Next.js 16.4), tải trang không qua trình duyệt | 11 test; phát hiện `loading.tsx` ở trang spa biến 404 và 308 thành 200, và header trong `next.config` bị cố định lúc build; 7 lớp chặn, bỏ cái nào cũng có test fail |
| `tasks.py` (1.2.0) | 49 test `unittest` trên Python 3.8 và 3.12 | Phát hiện thư mục trống vẫn in "All tasks done"; 12 lớp chặn, bỏ cái nào cũng có test fail |
| GitHub Actions (CI, deploy, E2E, kiểm tải, bảo mật) | actionlint | Đạt |
| Chuẩn Agent Skills | `agentskills validate` (bộ kiểm tham chiếu) cho cả 12 skill, chạy trong CI | Đạt |

Chưa chạy ở đây: dùng skill trong agent khác Claude Code (môi trường kiểm không có Codex, Cursor, Copilot hay Gemini). Skill theo đúng chuẩn và qua bộ kiểm của chuẩn; gặp lỗi xin mở issue.

## Eval: có và không có skill

`plugins/vibe/evals/` có 26 case: yêu cầu thật (bằng tiếng Việt, như người dùng gõ) kèm tiêu chí chấm. Phần lớn tiêu chí kiểm khách quan: công cụ nào được gọi, theo thứ tự nào (viết test và thấy fail trước khi sửa), nội dung file sau khi chạy, có spawn agent không. Mỗi case chạy 3 lượt có skill và 3 lượt không (`claude plugin eval`, model và judge mặc định của lệnh). Kết quả bản 1.1.0, chạy trong Claude Code:

| Case | Có skill | Không | Khác biệt chính |
|---|---|---|---|
| **Mới ở 1.1.0:** màn hình lịch hẹn tự cập nhật (realtime) | **1.00** | 0.53 | Stream kiểm quyền theo từng spa, có test chứng minh sự kiện của spa này không tới spa khác: 3/3 so với 0/3; mỗi instance một kết nối LISTEN, stream kết thúc khi nhân viên bị gỡ: 3/3 so với 0/3 |
| **Mới:** nhập 20.000 khách từ Excel/CSV | **1.00** | 0.60 | Job chạy tiếp được theo từng lô đã commit, có ngữ cảnh tenant: 3/3 so với 0/3; chống chèn công thức trong CSV xuất ra và kiểm UTF-8: 3/3 so với 0/3 |
| **Mới:** nhắc lịch qua Zalo, dự phòng SMS, tin khuyến mãi | **1.00** | 0.60 | Refresh token Zalo xoay vòng, làm mới từ một nơi: 3/3 so với 0/3; luật tin quảng cáo (đồng ý, 7h–22h, 3 tin/24 giờ): 3/3 so với 0/3 |
| **Mới:** SEO trang spa công khai, ẩn app và staging | **1.00** | 0.60 | Trang spa trả 404/308 thật, không có `loading.tsx` bọc phần tra cứu: 3/3 so với 0/3; noindex cho staging quyết định lúc chạy: 3/3 so với 1/3 |
| **Mới:** đặt cọc online qua chuyển khoản QR hoặc VNPay | **1.00** | 0.73 | Nội dung chuyển khoản bị sửa, trả thiếu, webhook trùng: 3/3 so với 0/3 |
| **Mới:** Việt/Anh, giá và giờ cho chi nhánh Singapore | **0.80** | 0.60 | "Hôm nay" tính theo nửa đêm địa phương, có test ở 16:59:59Z/17:00:00Z: 3/3 so với 0/3; kiểm file dịch trong CI: 1/3 so với 0/3 |
| **Mới:** gõ "nguyen thao" ra "Nguyễn Thị Thảo" khi có RLS | **1.00** | 0.80 | Nhận ra RLS khiến LIKE không dùng được index trigram và xử lý: 3/3 so với 1/3 |
| Màn danh sách chậm, team định thêm Redis | **1.00** | 0.56 | Kiểm tải có ngưỡng trên staging: 3/3 so với 0/3 |
| Sửa bug `slugify('Đường')` | **1.00** | 0.67 | Thấy test tái hiện fail trước khi sửa: 3/3 so với 1/3 |
| Phát hành app mobile vừa thêm `expo-camera` qua EAS Update | **1.00** | 0.67 | Build mới, thử trước, phát hành dần, khai báo quyền camera: 3/3 so với 0/3 |
| Khách yêu cầu xoá dữ liệu (luật Việt Nam) | **1.00** | 0.67 | Đúng văn bản đang hiệu lực và thời hạn (xác nhận trong 2 ngày làm việc, xoá trong 20 ngày): 3/3 so với 0/3 |
| Tính năng AI tóm tắt ghi chú khách | **1.00** | 0.75 | Có `max_tokens`, kiểm `stop_reason`, lỗi API thành thông báo dễ hiểu: 3/3 so với 0/3 |
| Đổi workspace mà màn hình vẫn hiện dữ liệu cũ | **1.00** | 0.75 | Huỷ request và bỏ cache của workspace cũ: 3/3 so với 0/3 |
| Chuyển token app mobile khỏi AsyncStorage | **0.94** | 0.78 | Xoá token Keychain còn sót sau khi cài lại app: 2/3 so với 0/3 (lượt thiếu ý này không nạp skill) |
| "Tới đâu rồi, làm gì tiếp?" trên task card | **1.00** | 0.80 | Báo tiến độ từ task card: 3/3 so với 1/3 |
| Viết test Playwright cho luồng đổi workspace | **1.00** | 0.80 | Locator theo role/label: 3/3 so với 0/3 |
| Chọn kiến trúc cho team 3 người | **1.00** | 0.93 | Ranh giới module được công cụ kiểm: 3/3 so với 2/3 |
| Bảo mật app Electron | 0.96 | **1.00** | Một lượt có skill trượt tiêu chí renderer (giám khảo không thấy file renderer ở đường dẫn mong đợi) |
| Xem trước link (SSRF) | 0.92 | **1.00** | Không lượt nào nạp skill; một lượt bị chấm là kiểm địa chỉ chưa đủ |
| Backfill NOT NULL khi có FORCE RLS, RLS cho memberships, đổi tên cột không downtime, theo pattern codebase, có nên chạy song song task nhỏ, thiết kế job nhắc lịch | 1.00 | 1.00 | Không có skill cũng làm đúng |
| **Việc nhỏ** ("đổi chữ nút Lưu"): không dựng quy trình, không spawn agent | 1.00 | 1.00 | Skill không làm agent "quan liêu" hơn |
| **Trung bình 26 case** | **0.98** | 0.80 | 7 case mới: 0.97 so với 0.64 |

Ghi chú về lượt chạy này:
- **Chạy lại 6 case.** Lượt chạy dừng ở giới hạn 30 phút, nên 6 case cuối được chạy lại riêng.
- **Case đa ngôn ngữ.** Sau lượt đầu, hai tiêu chí chấm được viết lại: một tiêu chí đánh trượt câu trả lời đúng chỉ vì nhắc lại câu query lỗi như nguyên nhân, một tiêu chí đòi hai thứ cùng lúc. Skill frontend cũng được thêm một dòng quy tắc. Số liệu của case này lấy từ lượt chạy lại.
- **Case thanh toán.** Bản đầu bảo agent sửa một handler IPN VNPay lỗi quá lộ; cả hai bên đều được 1.00, nên đã thay bằng câu hỏi thiết kế ở trên.

So với các bản trước, cùng thiết lập:

| | 0.5.0 | 1.0.0 | 1.1.0 |
|---|---|---|---|
| Số case | 19 | 19 | 26 |
| Điểm có / không có skill | 0.99 / 0.85 | 0.99 / 0.85 | 0.98 / 0.80 (cùng 19 case cũ: 0.99 / 0.86) |
| Mô tả skill luôn nằm trong context | 4.581 token | 3.620 | 3.791 (7 tài liệu mới tốn thêm 171 token) |
| Chi phí mỗi lượt có skill so với không | 1,59 lần | 1,46 lần | 1,52 lần |
| Số lượt skill được nạp | 42/54 | 44/54 | 60/75 |

Skill tiếng Anh vẫn được gọi đúng khi yêu cầu viết bằng tiếng Việt, và agent vẫn trả lời bằng tiếng Việt. Trong Claude Code, năm lệnh tắt (`vibe-help`, `vibe-start`...) không nằm trong context cho tới khi bạn gõ.

Cái giá: agent đọc tài liệu của skill trước khi trả lời, nên mỗi lượt tốn khoảng 1,5 lần so với không có skill (trung bình khoảng 0,16 USD mỗi lượt ở các case trên); việc nhỏ chỉ tốn thêm phần mô tả skill. Chạy lại sau mỗi lần sửa skill (mỗi lượt là một lần gọi model thật, tính phí theo tài khoản):

```bash
claude plugin eval ./plugins/vibe --runs 3 --no-publish --trust-plugin --scaffold --allow-tools "Bash" "Write" "Edit"
```

Linux cần `bubblewrap` và `socat` để sandbox của eval chạy được Bash.

## Dùng trong dự án

- `AGENTS.md` (skill plan tạo): lệnh, quy ước, quy tắc bắt buộc. Agent nào cũng đọc.
- Việc nhỏ (sửa chữ, đổi màu một nút) cứ làm thẳng: skill nào cũng có phần "cân đúng mức" để không dựng quy trình thừa.
- Chạy song song nhiều agent là tuỳ chọn, cần agent chạy được subagent hoặc nhiều phiên (cấu hình Claude Code ở `references/parallel.md` của `vibe-build`).

## Đóng góp

- Đọc [CONTRIBUTING.md](CONTRIBUTING.md). Nguyên tắc số một: ví dụ nào thêm vào cũng phải chạy được.
- Tác giả: thaiphan ([@HoangThai18](https://github.com/HoangThai18)). Giấy phép MIT.
