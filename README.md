<p align="center">
  <img src="assets/hero.svg" width="100%" alt="vibe: bộ skill Claude Code để vibe code ra phần mềm thật. 11 skill: plan, tasks, architecture, backend, frontend, mobile, desktop, build, review, ship, fix.">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-7C3AED?style=flat-square"></a>
  <a href="https://code.claude.com/docs/en/plugins"><img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-0891B2?style=flat-square"></a>
  <img alt="11 skills, 2 agents" src="https://img.shields.io/badge/skills-11%20·%20agents%202-DB2777?style=flat-square">
  <img alt="Examples verified on PostgreSQL 16 and Playwright" src="https://img.shields.io/badge/ví%20dụ-đã%20chạy%20thật-059669?style=flat-square">
  <a href="plugins/vibe/evals"><img alt="Eval: 1.00 with plugin vs 0.90 without, 11 cases" src="https://img.shields.io/badge/eval-1.00%20có%20plugin%20·%200.90%20không-F59E0B?style=flat-square"></a>
</p>

<p align="center"><b>Tiếng Việt</b> · <a href="#english">English</a></p>

Vibe code thì nhanh, nhưng phần mềm chạy thật cần thêm nhiều thứ mà prompt hay bỏ quên: hiểu đúng nghiệp vụ, test đi cùng code, dữ liệu khách này không lộ sang khách kia, migration không làm sập bản đang chạy, có đường rollback, backup đã restore thử. **vibe** gói những kinh nghiệm đó thành 11 skill cho Claude Code, cho cả web, app mobile (iOS, Android) và app desktop (Windows, macOS, Linux). Claude tự gọi đúng skill theo câu bạn nói, và chỉ đọc phần tài liệu cần cho việc đang làm.

```bash
claude plugin install vibe --marketplace HoangThai18/vibe-code-pro
```

Rồi nói chuyện bình thường: *"phân tích nghiệp vụ app đặt lịch spa"*, *"tới đâu rồi, làm gì tiếp?"*, *"làm task P1-T03"*, *"deploy lên production"*, *"lỗi 500 khi tạo khách"*.

## Quy trình

<p align="center">
  <img src="assets/flow.svg" width="100%" alt="Ý tưởng → plan → tasks → build → review → ship → chạy thật. Build dùng skill architecture, backend, frontend, mobile, desktop. Có lỗi thì qua fix rồi quay lại tasks.">
</p>

Thiết kế theo hướng Anthropic khuyến nghị cho agent: **một agent chính + skills + tools**. Kiến thức chuyên môn nằm trong skill và chỉ nạp khi cần (progressive disclosure); sub-agent chỉ dùng khi thật sự đáng: kiểm chứng độc lập, chạy song song các task lớn và độc lập, hoặc khảo sát một lượng code rất lớn mà chỉ cần kết luận. Phần luôn có mặt trong mỗi phiên chỉ là mô tả ngắn của 11 skill và 2 agent, khoảng 3.6k token (theo `claude plugin details`); hỏi về rollback thì chỉ đọc thêm `release-rollback.md`, không nạp cả bộ.

| Skill | Lo phần | Tài liệu nạp khi cần |
|---|---|---|
| `plan` | Làm rõ yêu cầu, phân tích nghiệp vụ, research người dùng / đối thủ / tech stack, PRD, kiến trúc, chia phase, chọn công cụ cho Claude (Context7, Playwright, Chrome DevTools, Figma, Supabase, GitHub, LSP) | domain-analysis, tech-research, dev-tools, 6 template |
| `tasks` | Task card có deps và file sẽ đụng, tiến độ, việc tiếp theo, handoff giữa các phiên | `tasks.py`, template, ví dụ mini CRM |
| `architecture` | Code theo đúng quy ước của codebase; chọn kiến trúc hợp với yêu cầu (modular monolith, layered, hexagonal, DDD, CQRS, event-driven, microservices); SOLID, pattern, refactor | codebase-conventions, architecture-styles, ddd, design-principles |
| `backend` | Schema, index, transaction, migration an toàn, ORM (Prisma, Drizzle, TypeORM, Sequelize, SQLAlchemy, Django, GORM, ActiveRecord), multi-tenant + Postgres RLS, API contract, xác thực và phân quyền | data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth |
| `frontend` | Web: UI theo mockup (Claude Design, Figma), motion, state/store (TanStack Query, Zustand, Redux, Pinia...), đổi workspace an toàn | design-to-code, motion-spec, state-management |
| `mobile` | App iOS và Android: chọn stack (Expo / React Native, Flutter, native, PWA), token trong Keychain/Keystore, offline và hàng đợi ghi, push, deep link, test (Jest, Maestro), EAS Build, OTA update, duyệt store, buộc cập nhật | choose-stack, app-data, platform-features, testing, release |
| `desktop` | App Windows, macOS, Linux: chọn Tauri / Electron / PWA, cấu hình bảo mật Electron (isolation, sandbox, IPC kiểm nguồn gửi), lưu token qua kho khoá hệ điều hành, test bằng Playwright, ký số, notarize, tự cập nhật | choose-stack, security, app-data, testing, release |
| `build` | Một agent làm cả code lẫn test cho từng task, chọn mức test, **test giao diện và luồng người dùng bằng Playwright**, khi nào mới chạy song song | testing, e2e-playwright, parallel, agent-brief |
| `review` | Nghiệm thu có bằng chứng, verifier độc lập, verdict PASS / BLOCK, báo cáo | checklist |
| `ship` | CI/CD, deploy kèm migration đúng thứ tự, feature flag, **rollback**, giám sát, **backup và restore**, bảo trì | ci-cd, release-rollback, observability, backup-restore, maintenance |
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
| Ví dụ TypeScript (DDD, state, auth, webhook) | `tsc --strict` + unit test | Đạt |
| GitHub Actions (CI, deploy, E2E) | actionlint; script role cho CI chạy trên Postgres sạch | Đạt |

## Cài đặt

**Qua GitHub (khuyên dùng):**

```bash
claude plugin install vibe --marketplace HoangThai18/vibe-code-pro    # Claude Code 2.1.275 trở lên
```

Bản Claude Code cũ hơn: `claude plugin marketplace add HoangThai18/vibe-code-pro` rồi `claude plugin install vibe@lovinbot-skills` (trong phiên thì dùng `/plugin ...` tương ứng). Cập nhật: `claude plugin marketplace update lovinbot-skills`.

**Thử từ thư mục đã clone:**

```bash
claude --plugin-dir ./plugins/vibe
```

**Copy thẳng vào một dự án** (lệnh thành `/vibe-plan`, `/vibe-review`...):

```bash
# 1. Kiểm trùng tên: lệnh này phải không in ra gì. Có thì đổi tên thư mục/file của bạn trước.
ls -d .claude/skills/{plan,tasks,architecture,backend,frontend,mobile,desktop,build,review,ship,fix} .claude/agents/{verifier,implementer}.md 2>/dev/null

# 2. Copy, rồi thêm tiền tố vibe- vào tên lệnh để không trùng lệnh có sẵn của Claude Code (vd /review)
mkdir -p .claude/skills .claude/agents
cp -r plugins/vibe/skills/* .claude/skills/
cp plugins/vibe/agents/*.md .claude/agents/
sed -i.bak 's/^name: /name: vibe-/' .claude/skills/{plan,tasks,architecture,backend,frontend,mobile,desktop,build,review,ship,fix}/SKILL.md
rm .claude/skills/{plan,tasks,architecture,backend,frontend,mobile,desktop,build,review,ship,fix}/SKILL.md.bak
```

Giữ nguyên tên thư mục để các skill tìm thấy tài liệu của nhau.

**Trên claude.ai:** `plan`, `architecture`, `backend`, `frontend`, `mobile`, `desktop`, phần kế hoạch của `ship` và phương pháp của `fix` dùng được: nén từng thư mục skill thành `.zip` rồi tải lên ở mục Skills trong cài đặt. `tasks`, `build`, `review` cần Claude Code (git, script, sub-agent).

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
    ├── backend/       data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth
    ├── frontend/      design-to-code, motion-spec, state-management
    ├── mobile/        choose-stack, app-data, platform-features, testing, release
    ├── desktop/       choose-stack, security, app-data, testing, release
    ├── build/         testing, e2e-playwright, parallel, agent-brief
    ├── review/        checklist
    ├── ship/          ci-cd, release-rollback, observability, backup-restore, maintenance · template RELEASE
    └── fix/           template POSTMORTEM
```
</details>

## Đo chất lượng: có plugin và không có plugin

`plugins/vibe/evals/` có 11 case là yêu cầu thật kèm tiêu chí chấm. Phần lớn tiêu chí kiểm khách quan: công cụ nào được gọi, gọi theo thứ tự nào (viết test trước khi sửa code), nội dung file sau khi chạy, có spawn agent không. Mỗi case chạy 3 lượt có plugin và 3 lượt không có plugin (`claude plugin eval`, model mặc định của lệnh, judge mặc định). Kết quả bản 0.3.0:

| Case | Có plugin | Không có | Khác biệt chính |
|---|---|---|---|
| Sửa bug `slugify('Đường')` | **1.00** | 0.58 | Viết test tái hiện và thấy nó fail trước khi sửa: 3/3 so với 0/3 |
| Đổi workspace mà màn hình vẫn hiện dữ liệu cũ | **1.00** | 0.75 | Huỷ request và bỏ cache của workspace cũ đúng cách: 3/3 so với 0/3 |
| "Tới đâu rồi, làm gì tiếp?" trên task card | **1.00** | 0.80 | Làm nốt task dở trước, không chọn task bị chặn: 3/3 so với 1/3 |
| Chọn kiến trúc cho team 3 người | **1.00** | 0.87 | Có điều kiện xem lại cụ thể và cách giữ ranh giới module |
| Viết test Playwright cho luồng đổi workspace | **1.00** | 0.93 | Locator theo role/label, không chờ bằng thời gian cố định |
| RLS cho memberships, backfill NOT NULL khi có FORCE, đổi tên cột không downtime, theo pattern codebase, có nên chạy song song task nhỏ | 1.00 | 1.00 | Không có plugin cũng làm đúng |
| **Việc nhỏ** ("đổi chữ nút Lưu"): không dựng quy trình, không spawn agent | 1.00 | 1.00 | Plugin không làm Claude "quan liêu" hơn |
| **Trung bình 11 case** | **1.00** | 0.90 | Không case nào tệ đi khi có plugin |

Cái giá: Claude đọc thêm tài liệu của skill trước khi trả lời, nên mỗi lượt tốn trung bình khoảng 1.5 lần token so với không có plugin (vài cent mỗi lượt ở các case trên); việc nhỏ chỉ tăng phần mô tả skill luôn có mặt. Chạy lại sau mỗi lần sửa skill (mỗi lượt là một lần chạy model thật, tính phí theo tài khoản):

```bash
claude plugin eval ./plugins/vibe --runs 3 --no-publish --trust-plugin --scaffold --allow-tools "Bash" "Write" "Edit"
```

Linux cần `bubblewrap` và `socat` để eval chạy được Bash trong sandbox.

## Tuỳ biến và đóng góp

- Checklist review riêng của team: `skills/review/references/checklist.md`; quy ước API: `skills/backend/references/api-conventions.md`.
- Phát hành bản mới thì tăng `version` trong `plugins/vibe/.claude-plugin/plugin.json`.
- Đóng góp: đọc [CONTRIBUTING.md](CONTRIBUTING.md). Nguyên tắc số một: ví dụ nào thêm vào cũng phải chạy được.

## English

**vibe** is a Claude Code plugin (written in Vietnamese) that turns "vibe coding" into a full software lifecycle: domain analysis and planning, task cards with dependencies, backend, web, mobile and desktop guidance (multi-tenant Postgres RLS, 8 ORMs, auth, state management, Expo/React Native with EAS and store review, Electron/Tauri security, signing and auto-update), test-with-the-code builds including Playwright UI/workflow tests, independent review, CI/CD with rollback, monitoring and backup/restore, and incident handling. It follows Anthropic's single-agent guidance: one main agent, skills loaded on demand, subagents only for independent verification and large parallel tasks. Code, SQL and workflow examples were executed before being documented (PostgreSQL 16, Playwright 1.63, TypeScript strict, actionlint). On its 11-case eval suite (3 runs per arm) it scores 1.00 with the plugin versus 0.90 without, with no case getting worse, at roughly 1.5× the tokens per run.

Install: `claude plugin install vibe --marketplace HoangThai18/vibe-code-pro` (Claude Code 2.1.275+). MIT licensed.
