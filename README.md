<p align="center">
  <img src="assets/hero.svg" width="100%" alt="vibe: bộ skill Claude Code để vibe code ra phần mềm thật. 12 skill: plan, tasks, architecture, backend, frontend, mobile, desktop, ai, build, review, ship, fix.">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-7C3AED?style=flat-square"></a>
  <a href="https://code.claude.com/docs/en/plugins"><img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-0891B2?style=flat-square"></a>
  <img alt="12 skills, 5 shortcut commands, 2 agents" src="https://img.shields.io/badge/skills-12%20·%20lệnh%20tắt%205%20·%20agents%202-DB2777?style=flat-square">
  <img alt="Examples verified on PostgreSQL 16 and Playwright" src="https://img.shields.io/badge/ví%20dụ-đã%20chạy%20thật-059669?style=flat-square">
  <a href="plugins/vibe/evals"><img alt="Eval: 1.00 with plugin vs 0.85 without, 14 cases" src="https://img.shields.io/badge/eval-1.00%20có%20plugin%20·%200.85%20không-F59E0B?style=flat-square"></a>
</p>

<p align="center"><b>Tiếng Việt</b> · <a href="#english">English</a></p>

Vibe code thì nhanh, nhưng phần mềm chạy thật cần thêm nhiều thứ mà prompt hay bỏ quên: hiểu đúng nghiệp vụ, test đi cùng code, dữ liệu khách này không lộ sang khách kia, migration không làm sập bản đang chạy, có đường rollback, backup đã restore thử. **vibe** gói những kinh nghiệm đó thành 12 skill cho Claude Code, cho cả web, app mobile (iOS, Android), app desktop (Windows, macOS, Linux) và tính năng AI trong app. Claude tự gọi đúng skill theo câu bạn nói, và chỉ đọc phần tài liệu cần cho việc đang làm.

```bash
claude plugin install vibe --marketplace HoangThai18/vibe-code-pro
```

Rồi gõ `/vibe:start` kèm ý tưởng, hoặc cứ nói chuyện bình thường: *"phân tích nghiệp vụ app đặt lịch spa"*, *"tới đâu rồi?"*, *"làm tiếp"*, *"lỗi 500 khi tạo khách"*, *"deploy lên staging"*.

### Lệnh nhanh

| Gõ | Để làm gì |
|---|---|
| `/vibe:start <ý tưởng>` | Bắt đầu: dự án mới thì phân tích nghiệp vụ, lên plan, chia task; dự án có sẵn thì khảo sát code, tạo `CLAUDE.md` |
| `/vibe:status` | Tới đâu rồi: tiến độ, task đang làm, task bị chặn, việc nên làm tiếp |
| `/vibe:next [P1-T03]` | Làm việc tiếp theo (hoặc đúng task đó): code kèm test, cập nhật task card |
| `/vibe:check` | Kiểm trước khi merge: test, review độc lập, PASS hoặc BLOCK |
| `/vibe:fix <mô tả lỗi>` | Sửa bug, xử lý sự cố |
| `/vibe:ship <việc>` | Deploy, rollback, backup, giám sát |
| `/vibe:help` | Bảng lệnh và gợi ý lệnh nên dùng tiếp theo trạng thái dự án |

Một vòng làm việc: `/vibe:start` → `/vibe:next` → `/vibe:check` → merge → `/vibe:next`... Quên lệnh thì gõ `/vibe:help` hoặc nói bằng lời. Lệnh tắt chỉ chạy khi bạn gõ, không chiếm token nào trong phiên.

## Quy trình

<p align="center">
  <img src="assets/flow.svg" width="100%" alt="Ý tưởng → plan → tasks → build → review → ship → chạy thật. Build dùng skill architecture, backend, frontend, mobile, desktop, ai. Có lỗi thì qua fix rồi quay lại tasks.">
</p>

Thiết kế theo hướng Anthropic khuyến nghị cho agent: **một agent chính + skills + tools**. Kiến thức chuyên môn nằm trong skill và chỉ nạp khi cần (progressive disclosure); sub-agent chỉ dùng khi thật sự đáng: kiểm chứng độc lập, chạy song song các task lớn và độc lập, hoặc khảo sát một lượng code rất lớn mà chỉ cần kết luận. Phần luôn có mặt trong mỗi phiên chỉ là mô tả ngắn của 12 skill và 2 agent, khoảng 4.1k token (theo `claude plugin details`; 5 lệnh tắt không tính vì chỉ nạp khi bạn gõ); hỏi về rollback thì chỉ đọc thêm `release-rollback.md`, không nạp cả bộ.

| Skill | Lo phần | Tài liệu nạp khi cần |
|---|---|---|
| `plan` | Làm rõ yêu cầu, phân tích nghiệp vụ, research người dùng / đối thủ / tech stack, PRD, kiến trúc, chia phase, chọn công cụ cho Claude (Context7, Playwright, Chrome DevTools, Figma, Supabase, GitHub, LSP) | domain-analysis, tech-research, dev-tools, 6 template |
| `tasks` | Task card có deps và file sẽ đụng, tiến độ, việc tiếp theo, handoff giữa các phiên | `tasks.py`, template, ví dụ mini CRM |
| `architecture` | Code theo đúng quy ước của codebase; chọn kiến trúc hợp với yêu cầu (modular monolith, layered, hexagonal, DDD, CQRS, event-driven, microservices); SOLID, pattern, refactor | codebase-conventions, architecture-styles, ddd, design-principles |
| `backend` | Schema, index, transaction, migration an toàn, ORM (Prisma, Drizzle, TypeORM, Sequelize, SQLAlchemy, Django, GORM, ActiveRecord), multi-tenant + Postgres RLS, API contract, xác thực và phân quyền, **job nền** (hàng đợi, retry, cron), **bảo mật ứng dụng** (upload, SSRF, rate limit, quét secret), **dữ liệu cá nhân theo luật Việt Nam** | data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, jobs, app-security, privacy |
| `frontend` | Web: UI theo mockup (Claude Design, Figma), motion, state/store (TanStack Query, Zustand, Redux, Pinia...), đổi workspace an toàn | design-to-code, motion-spec, state-management |
| `mobile` | App iOS và Android: chọn stack (Expo / React Native, Flutter, native, PWA), token trong Keychain/Keystore, offline và hàng đợi ghi, push, deep link, test (Jest, Maestro), EAS Build, OTA update, duyệt store, buộc cập nhật | choose-stack, app-data, platform-features, testing, release |
| `desktop` | App Windows, macOS, Linux: chọn Tauri / Electron / PWA, cấu hình bảo mật Electron (isolation, sandbox, IPC kiểm nguồn gửi), lưu token qua kho khoá hệ điều hành, test bằng Playwright, ký số, notarize, tự cập nhật | choose-stack, security, app-data, testing, release |
| `ai` | Tính năng AI trong app: gọi Claude API từ server, structured output, streaming, chống prompt injection, cô lập tenant, ngân sách và usage theo tenant, test không tốn tiền, eval chất lượng | design, integration, safety, cost, testing |
| `build` | Một agent làm cả code lẫn test cho từng task, chọn mức test, **test giao diện và luồng người dùng bằng Playwright**, khi nào mới chạy song song | testing, e2e-playwright, parallel, agent-brief |
| `review` | Nghiệm thu có bằng chứng, verifier độc lập, verdict PASS / BLOCK, báo cáo | checklist |
| `ship` | CI/CD, deploy kèm migration đúng thứ tự, feature flag, **rollback**, giám sát, **backup và restore**, bảo trì, **hiệu năng và kiểm tải** (k6, query chậm, Web Vitals) | ci-cd, release-rollback, observability, backup-restore, maintenance, performance |
| `fix` | Sửa bug bằng test tái hiện trước, sự cố production, nghi lộ dữ liệu, postmortem | template POSTMORTEM |

| Agent | Khi nào dùng |
|---|---|
| `verifier` | Review độc lập: ngữ cảnh mới, chỉ đọc, chạy kiểm tra và soi diff, không bị neo vào cách nghĩ của người viết code |
| `implementer` | Chỉ khi chạy song song nhiều task **lớn và độc lập**, mỗi agent một git worktree. Mặc định session chính tự làm |

## Tiến độ nằm trong repo, không nằm trong trí nhớ của chat

<p align="center">
  <img src="assets/terminal.svg" width="90%" alt="Output thật của tasks.py status và tasks.py next trên dự án mẫu mini-crm: tiến độ theo phase, task đang làm, task sẵn sàng, task chờ deps.">
</p>

Task card là file Markdown trong `docs/tasks/`, nên phiên nào, máy nào cũng làm tiếp được. `tasks.py` (Python 3.8+, không cần cài thêm) kiểm lỗi deps, xếp thứ tự, phát hiện hai task cùng sửa một file, và gợi ý đúng một việc tiếp theo. Thử ngay với dữ liệu mẫu:

```bash
S=plugins/vibe/skills/tasks
python3 $S/scripts/tasks.py status --dir $S/examples/mini-crm
python3 $S/scripts/tasks.py next   --dir $S/examples/mini-crm
```

## Đã chạy thật, không chỉ viết ra

Tài liệu cho phần mềm thật mà ví dụ sai thì còn hại hơn không có. Các đoạn code, SQL, workflow trong bộ skill được chạy thử trước khi đưa vào:

| Phần | Cách kiểm | Kết quả |
|---|---|---|
| Multi-tenant SQL: RLS, policy đọc/ghi tách riêng, composite FK, kiểm membership theo request, tra workspace trước đăng nhập, Supabase | Chạy nguyên văn trên PostgreSQL 16 bằng role app, kèm các phép thử tấn công chéo tenant | Chặn đúng. Hai lỗ hổng của bản cũ đã được sửa: policy có `OR` cho ghi chéo tenant, và bảng tra slug ghi được bằng role app (chiếm slug của tenant khác) |
| Backup và restore | `pg_dump` bằng role backup, restore sang cluster mới bằng admin **không** phải superuser, rồi kiểm owner, RLS, số dòng, migration tiếp theo | 0 lỗi. Quá trình kiểm bắt được 2 lỗi thật của tài liệu cũ (role backup thiếu quyền trên bảng mới; `ALTER DEFAULT PRIVILEGES` thiếu `FOR ROLE`) |
| Test giao diện Playwright | 21 test (nhiều vai trò, giờ server/trình duyệt, mock lỗi, so ảnh, a11y) trên Chromium, lặp 5 lần × 4 worker, trên bản app thường, bản huỷ request khi đổi trang và bản có `role="alert"` sẵn như Next.js | Không chập chờn. Hai test đổi workspace fail mọi lần trên hai bản app cố ý cài lỗi (response cũ đè màn hình mới; giữ danh sách cũ lúc đang tải) |
| Test cô lập tenant | Chạy trên app đúng và 3 bản lỗi: rò dữ liệu theo id, quên kiểm membership, route sai path | Bắt được cả 3; phần đối chứng bắt được trường hợp test "pass mà không kiểm gì" |
| 8 ORM: Prisma 7, Drizzle, TypeORM, Sequelize, SQLAlchemy 2, Django, GORM, ActiveRecord | Mỗi ví dụ "trừ kho + tạo đơn" chạy trên PostgreSQL 16: còn hàng, hết hàng, và hai transaction tranh nhau cùng lúc | Đạt cả 8. Quá trình kiểm bắt được lỗi bán vượt tồn ở bản cũ (trừ kho không kiểm số dòng bị ảnh hưởng) |
| Ví dụ TypeScript (DDD, state, auth, webhook, chặn bản app quá cũ bằng `426 app_update_required`) | `tsc --strict` + unit test | Đạt |
| App mobile Expo SDK 58: điều hướng có guard, token trong SecureStore, API client, hàng đợi offline SQLite, push, test component, `app.config.ts`, `eas.json` | `tsc --strict`, Jest (jest-expo, React Native Testing Library 14) chạy cả khi chưa có cache; `eas.json` kiểm bằng bộ đọc cấu hình của `eas-cli`; đo runtime version theo từng biến thể | Đạt. Quá trình kiểm bắt được lỗi của bản nháp: thiếu `types: ["jest"]` với TypeScript 6, Jest không thoát vì hẹn giờ của QueryClient, test quá giờ trên CI chưa có cache, và quy trình OTA sai (mỗi biến thể có runtime version riêng; `eas update` không đọc `env` của profile build; thiếu `--environment`) |
| App desktop: cấu hình bảo mật Electron (scheme `app://`, IPC kiểm nguồn gửi, chặn điều hướng), `safeStorage`; Tauri: capability, command Rust, updater | Electron 45 + Playwright 1.64 (`tsc --strict`, 100 lượt liên tiếp) trên app mẫu và 8 bản cố ý cấu hình sai; build Tauri 2.12 thật, ký file cập nhật | Bắt được cả 8 bản lỗi. Quá trình kiểm bắt được lỗi của bản nháp: test điều hướng bị treo, test path traversal không kiểm gì (URL tự chuẩn hoá `%2e%2e`), lỗi type, một test chập chờn, `safeStorage` dùng API đã deprecated |
| Tính năng AI: gọi Claude API, structured output, streaming có huỷ, ngân sách và usage theo tenant | `@anthropic-ai/sdk` 1.3 với fetch giả (không gọi API thật), `tsc --strict`; bảng usage trên PostgreSQL 16; bỏ từng lớp bảo vệ xem test có bắt không | Đạt. Bỏ che số điện thoại, bỏ JSON hoá dữ liệu, bỏ huỷ stream, bỏ ghi usage hay bỏ kiểm ngân sách thì đều có test fail. Eval gọi API thật chưa chạy được vì môi trường kiểm không có API key |
| Job nền với pg-boss: nhắc lịch hẹn, retry, dead letter, chạy theo lịch | pg-boss 12.38 trên PostgreSQL 16 có RLS `FORCE`, worker thật, nhà cung cấp SMS giả | 6 test đạt; bỏ UNIQUE, bỏ kiểm trạng thái, bỏ kiểm lịch đã huỷ hay nới cửa sổ thời gian thì có test fail |
| Hiệu năng: `pg_stat_statements`, index, kiểm tải k6, Web Vitals | k6 1.8.2 vào API mẫu có 500.000 khách; Playwright 1.64 + `web-vitals` 6 | Thêm đúng index: p95 từ 2,74 giây xuống 1,97 ms ở cùng mức tải. Test ngân sách bắt được trang có CLS 0,23 |
| Bảo mật ứng dụng: chống SSRF, kiểm file upload, rate limit, quét secret | Node 22, PostgreSQL 16, gitleaks 8.30 | 12 test đạt; bỏ từng lớp chặn SSRF thì có test fail; 50 request song song với giới hạn 10 thì đúng 10 request qua; gitleaks bắt được key giả kể cả khi file đã bị xoá |
| Dữ liệu cá nhân: lưu đồng ý, hạn xử lý yêu cầu của chủ dữ liệu | PostgreSQL 16 có RLS; test hàm tính hạn | Đạt. Quá trình kiểm cho thấy view thiếu `security_invoker` (owner là superuser) để tenant B đọc được dữ liệu đồng ý của tenant A |
| GitHub Actions (CI, deploy, E2E) | actionlint; script role cho CI chạy trên Postgres sạch | Đạt |

## Cài đặt

**Qua GitHub (khuyên dùng):**

```bash
claude plugin install vibe --marketplace HoangThai18/vibe-code-pro    # Claude Code 2.1.275 trở lên
```

Bản Claude Code cũ hơn: `claude plugin marketplace add HoangThai18/vibe-code-pro` rồi `claude plugin install vibe@vibe-code-pro` (trong phiên thì dùng `/plugin ...` tương ứng). Cập nhật: `claude plugin marketplace update vibe-code-pro`.

**Thử từ thư mục đã clone:**

```bash
claude --plugin-dir ./plugins/vibe
```

**Copy thẳng vào một dự án** (lệnh thành `/vibe-start`, `/vibe-next`, `/vibe-plan`...):

```bash
# 1. Kiểm trùng tên: lệnh này phải không in ra gì. Có thì đổi tên thư mục/file của bạn trước.
ls -d .claude/skills/{plan,tasks,architecture,backend,frontend,mobile,desktop,ai,build,review,ship,fix,help,start,status,next,check} .claude/agents/{verifier,implementer}.md 2>/dev/null

# 2. Copy, rồi thêm tiền tố vibe- vào tên lệnh để không trùng lệnh có sẵn của Claude Code (vd /review)
mkdir -p .claude/skills .claude/agents
cp -r plugins/vibe/skills/* .claude/skills/
cp plugins/vibe/agents/*.md .claude/agents/
sed -i.bak 's/^name: /name: vibe-/' .claude/skills/{plan,tasks,architecture,backend,frontend,mobile,desktop,ai,build,review,ship,fix,help,start,status,next,check}/SKILL.md
rm .claude/skills/{plan,tasks,architecture,backend,frontend,mobile,desktop,ai,build,review,ship,fix,help,start,status,next,check}/SKILL.md.bak
```

Giữ nguyên tên thư mục để các skill tìm thấy tài liệu của nhau.

**Trên claude.ai:** `plan`, `architecture`, `backend`, `frontend`, `mobile`, `desktop`, `ai`, phần kế hoạch của `ship` và phương pháp của `fix` dùng được: nén từng thư mục skill thành `.zip` rồi tải lên ở mục Skills trong cài đặt. `tasks`, `build`, `review` cần Claude Code (git, script, sub-agent).

## Dùng trong dự án

- `CLAUDE.md`: skill `plan` tạo theo template (lệnh, quy ước, quy tắc bắt buộc). Mọi agent đều đọc file này.
- Việc nhỏ (sửa chữ, đổi màu một nút) cứ làm thẳng: skill nào cũng có phần "cân đúng mức" để không dựng quy trình cho việc không cần.
- Chỉ khi muốn chạy song song nhiều agent, thêm vào `.claude/settings.json` (và `.claude/worktrees/` vào `.gitignore`):

```json
{
  "worktree": { "baseRef": "head" },
  "permissions": {
    "allow": ["Bash(pnpm test:*)", "Bash(pnpm typecheck)", "Bash(pnpm lint)", "Bash(pnpm install)", "Bash(git add:*)", "Bash(git commit:*)"]
  }
}
```

<details>
<summary>File quy trình tạo trong dự án</summary>

```text
CLAUDE.md            lệnh, quy ước, quy tắc bắt buộc, ghi chú stack
docs/domain/         DOMAIN.md: thuật ngữ, vai trò, quy trình, vòng đời, quy tắc BR-xx
docs/research/       ghi chú research, so sánh thư viện, kết quả spike
docs/plan/           PRD.md · ARCHITECTURE.md · PHASES.md
docs/contracts/      danh sách endpoint, ví dụ payload
docs/design/         kiểm kê design, motion spec, ảnh verify
docs/tasks/          task card, vd P1-T03-customers-api.md
docs/reviews/        báo cáo review
docs/releases/       checklist release + kế hoạch rollback
docs/postmortems/    postmortem sự cố
docs/STATUS.md       tiến độ, quyết định, rủi ro
docs/HANDOFF.md      lời nhắn cho phiên sau
```
</details>

<details>
<summary>Cấu trúc repo</summary>

```text
.claude-plugin/marketplace.json
assets/              hình README + make_graphics.py
plugins/vibe/
├── .claude-plugin/plugin.json
├── agents/          verifier · implementer
├── evals/           case đánh giá chất lượng (claude plugin eval)
└── skills/
    ├── plan/          domain-analysis, tech-research, dev-tools · template PRD, ARCHITECTURE, PHASES, DOMAIN, RESEARCH, CLAUDE
    ├── tasks/         scripts/tasks.py · template task, STATUS, HANDOFF · examples/mini-crm
    ├── architecture/  codebase-conventions, architecture-styles, ddd, design-principles
    ├── backend/       data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, jobs, app-security, privacy
    ├── frontend/      design-to-code, motion-spec, state-management
    ├── mobile/        choose-stack, app-data, platform-features, testing, release
    ├── desktop/       choose-stack, security, app-data, testing, release
    ├── ai/            design, integration, safety, cost, testing
    ├── build/         testing, e2e-playwright, parallel, agent-brief
    ├── review/        checklist
    ├── ship/          ci-cd, release-rollback, observability, backup-restore, maintenance, performance · template RELEASE
    ├── fix/           template POSTMORTEM
    └── help/ start/ status/ next/ check/   lệnh tắt (chỉ chạy khi gõ)
```
</details>

## Đo chất lượng: có plugin và không có plugin

`plugins/vibe/evals/` có 14 case là yêu cầu thật kèm tiêu chí chấm. Phần lớn tiêu chí kiểm khách quan: công cụ nào được gọi, gọi theo thứ tự nào (viết test trước khi sửa code), nội dung file sau khi chạy, có spawn agent không. Mỗi case chạy 3 lượt có plugin và 3 lượt không có plugin (`claude plugin eval`, model mặc định của lệnh, judge mặc định). Kết quả bản 0.4.0:

| Case | Có plugin | Không có | Khác biệt chính |
|---|---|---|---|
| Sửa bug `slugify('Đường')` | **1.00** | 0.50 | Viết test tái hiện và thấy nó fail trước khi sửa: 3/3 so với 0/3 |
| Phát hành app mobile vừa thêm `expo-camera` qua EAS Update | **1.00** | 0.58 | Đủ quy trình (build mới, thử trước khi phát hành, phát hành dần, khai báo quyền camera): 3/3 so với 0/3; tính đến người dùng còn ở bản cũ: 3/3 so với 1/3 |
| Chọn kiến trúc cho team 3 người | **1.00** | 0.73 | Có điều kiện cụ thể để xem lại quyết định: 3/3 so với 0/3 |
| "Tới đâu rồi, làm gì tiếp?" trên task card | **1.00** | 0.73 | Làm nốt task dở trước, không chọn task bị chặn: 3/3 so với 0/3 |
| Đổi workspace mà màn hình vẫn hiện dữ liệu cũ | **1.00** | 0.75 | Huỷ request và bỏ cache của workspace cũ đúng cách: 3/3 so với 0/3 |
| Viết test Playwright cho luồng đổi workspace | **1.00** | 0.80 | Locator theo role/label: 3/3 so với 1/3 |
| Chuyển token app mobile khỏi AsyncStorage | **1.00** | 0.83 | Xoá token mà Keychain iOS còn giữ sau khi gỡ app rồi cài lại: 3/3 so với 0/3 |
| RLS cho memberships, backfill NOT NULL khi có FORCE, đổi tên cột không downtime, theo pattern codebase, có nên chạy song song task nhỏ, review bảo mật app Electron | 1.00 | 1.00 | Không có plugin cũng làm đúng |
| **Việc nhỏ** ("đổi chữ nút Lưu"): không dựng quy trình, không spawn agent | 1.00 | 1.00 | Plugin không làm Claude "quan liêu" hơn |
| **Trung bình 14 case** | **1.00** | 0.85 | Không case nào tệ đi khi có plugin |

Cái giá: Claude đọc thêm tài liệu của skill trước khi trả lời, nên mỗi lượt tốn trung bình khoảng 1.6 lần chi phí so với không có plugin (vài cent mỗi lượt ở các case trên); việc nhỏ chỉ tăng phần mô tả skill luôn có mặt. Chạy lại sau mỗi lần sửa skill (mỗi lượt là một lần chạy model thật, tính phí theo tài khoản):

```bash
claude plugin eval ./plugins/vibe --runs 3 --no-publish --trust-plugin --scaffold --allow-tools "Bash" "Write" "Edit"
```

Linux cần `bubblewrap` và `socat` để eval chạy được Bash trong sandbox.

## Tuỳ biến và đóng góp

- Checklist review riêng của team: `skills/review/references/checklist.md`; quy ước API: `skills/backend/references/api-conventions.md`.
- Phát hành bản mới thì tăng `version` trong `plugins/vibe/.claude-plugin/plugin.json`.
- Tác giả: thaiphan ([@HoangThai18](https://github.com/HoangThai18)).
- Đóng góp: đọc [CONTRIBUTING.md](CONTRIBUTING.md). Nguyên tắc số một: ví dụ nào thêm vào cũng phải chạy được.

## English

**vibe** is a Claude Code plugin (written in Vietnamese) that turns "vibe coding" into a full software lifecycle: domain analysis and planning, task cards with dependencies, backend, web, mobile and desktop guidance (multi-tenant Postgres RLS, 8 ORMs, auth, state management, Expo/React Native with EAS and store review, Electron/Tauri security, signing and auto-update), test-with-the-code builds including Playwright UI/workflow tests, independent review, CI/CD with rollback, monitoring and backup/restore, and incident handling. It follows Anthropic's single-agent guidance: one main agent, skills loaded on demand, subagents only for independent verification and large parallel tasks. Code, SQL and workflow examples were executed before being documented (PostgreSQL 16, Playwright 1.63/1.64, Expo SDK 58, Electron 45, Tauri 2, TypeScript strict, actionlint). On its 14-case eval suite (3 runs per arm) it scores 1.00 with the plugin versus 0.85 without, with no case getting worse, at roughly 1.6× the cost per run.

Install: `claude plugin install vibe --marketplace HoangThai18/vibe-code-pro` (Claude Code 2.1.275+). MIT licensed.
