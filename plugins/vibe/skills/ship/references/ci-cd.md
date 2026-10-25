# CI/CD và môi trường

## Mục lục
1. Môi trường
2. Cấu hình và secret
3. CI trên mỗi pull request
4. CD: staging và production
5. Migration trong pipeline

## 1. Môi trường

| Môi trường | Dùng để | Dữ liệu |
|---|---|---|
| Local | phát triển | seed giả |
| Preview (mỗi PR, nếu nền tảng hỗ trợ) | xem nhanh thay đổi | seed giả |
| Staging | kiểm thử trước release, chạy E2E, diễn tập migration | giống production về cấu trúc, dữ liệu giả hoặc đã ẩn danh hoá |
| Production | người dùng thật | dữ liệu thật |

Staging càng giống production (cùng version DB, cùng cấu hình, cùng cách deploy) thì càng ít bất ngờ khi go-live.

## 2. Cấu hình và secret

- Cấu hình đọc từ biến môi trường, validate ngay lúc khởi động (thiếu biến thì app dừng với lỗi rõ ràng, không chạy nửa vời).
- `.env.example` liệt kê đủ biến với giá trị giả; `.env*` thật nằm trong `.gitignore`.
- Secret production trong secret manager của nền tảng hoặc GitHub Environments; mỗi môi trường một bộ khoá riêng.
- Lỡ commit secret thì coi như đã lộ: thu hồi và tạo khoá mới ngay, xoá khỏi lịch sử chỉ là việc phụ.

## 3. CI trên mỗi pull request

Mục tiêu: PR không merge được nếu lint, typecheck, test hoặc build fail. Ví dụ GitHub Actions cho Node + pnpm + Postgres (kiểm version mới nhất của các action và Node trước khi dùng):

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:16               # cùng major version với production
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      # Role giống production: migration chạy bằng owner, test chạy bằng role app
      # (không superuser), nếu không RLS bị bỏ qua và test pass sai.
      ADMIN_DATABASE_URL: postgres://postgres:postgres@localhost:5432/app_test
      MIGRATION_DATABASE_URL: postgres://app_owner:app_owner@localhost:5432/app_test
      DATABASE_URL: postgres://app_user:app_user@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4        # đọc version pnpm từ "packageManager" trong package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/ci-roles.sql
      - run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ env.MIGRATION_DATABASE_URL }}   # tool migrate đọc DATABASE_URL
      - run: pnpm test
      - run: pnpm build
```

`db/ci-roles.sql` tạo role cho DB tạm của CI (đoạn tạo `app_user` lấy từ skill `backend`, `postgres-rls.md` mục 1; từ file này: `../../backend/references/postgres-rls.md`):

```sql
CREATE ROLE app_owner LOGIN PASSWORD 'app_owner';
-- DB thuộc app_owner thì app_owner tạo bảng được trong schema public (Postgres 15+)
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I OWNER TO app_owner', current_database()); END $$;
-- tiếp theo: nguyên khối lệnh role ở postgres-rls.md mục 1, mật khẩu app_user là 'app_user'
-- (khối đó có ALTER DEFAULT PRIVILEGES FOR ROLE app_owner, nên bảng migration tạo ra tự cấp quyền cho app_user)
```

- Bật branch protection cho `main`: bắt buộc check CI pass và có review trước khi merge.
- E2E (Playwright): workflow riêng có shard và gộp report, mẫu ở skill `build` (từ file này: `../../build/references/e2e-playwright.md` mục 13). Chạy trên mỗi PR nếu bộ E2E nhanh, nếu không thì hằng đêm và trước release.
- Thêm quét bảo mật nhẹ: audit dependency, secret scanning của GitHub.

## 4. CD: staging và production

- Merge vào `main` → build artifact (image Docker hoặc bản build) gắn tag commit SHA → migration → deploy tự động lên staging → smoke test.
- Production: deploy **cùng artifact** đã chạy trên staging, kích hoạt bằng tay (hoặc bằng tag) qua GitHub Environment có required reviewers.
- Deploy không downtime: rolling hoặc blue-green tuỳ nền tảng; app có readiness check (mục healthcheck trong `observability.md`) để nhận traffic chỉ khi sẵn sàng.
- Sau deploy: smoke test tự động (healthcheck + 1–2 request quan trọng), theo dõi dashboard 15–30 phút.

Khung workflow (đã qua actionlint). `scripts/migrate.sh` và `scripts/deploy.sh` là phần riêng của nền tảng, viết theo tài liệu hiện hành của nền tảng đó (vd `docker run --rm -e DATABASE_URL "$1" pnpm db:migrate` cho migrate):

```yaml
# .github/workflows/deploy.yml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      image_tag:
        description: "Commit SHA của image đã chạy ổn trên staging (rollback: SHA của bản trước)"
        required: true
      run_migrations:
        description: "Chạy migration trước khi deploy. Rollback code thì bỏ chọn: DB đã ở version mới hơn image cũ"
        type: boolean
        default: true

permissions:
  contents: read

jobs:
  build:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write                    # chỉ job này cần đẩy image
    steps:
      - uses: actions/checkout@v4
      - name: Tên image (registry chỉ nhận chữ thường)
        run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}:${{ github.sha }}

  staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    concurrency: deploy-staging
    steps:
      - uses: actions/checkout@v4
      - run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - name: Migration bằng role owner, một lần, trước khi code mới nhận traffic
        run: ./scripts/migrate.sh "$IMAGE:$GITHUB_SHA"
        env:
          DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}
      - name: Deploy
        run: ./scripts/deploy.sh staging "$IMAGE:$GITHUB_SHA"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
      - name: Smoke test
        run: curl --fail --silent --retry 10 --retry-delay 6 --retry-all-errors "$APP_URL/health/ready"
        env:
          APP_URL: ${{ vars.APP_URL }}

  production:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment: production             # bật "Required reviewers" cho environment này
    concurrency: deploy-production
    env:
      TAG: ${{ inputs.image_tag }}       # qua env, không chèn thẳng vào lệnh shell
    steps:
      - name: Kiểm tag là commit SHA
        run: '[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "image_tag phải là SHA 40 ký tự"; exit 1; }'
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.image_tag }}  # script migrate/deploy cùng phiên bản với image
      - run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - if: ${{ inputs.run_migrations }}
        run: ./scripts/migrate.sh "$IMAGE:$TAG"
        env:
          DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}
      - run: ./scripts/deploy.sh production "$IMAGE:$TAG"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
      - run: curl --fail --silent --retry 10 --retry-delay 6 --retry-all-errors "$APP_URL/health/ready"
        env:
          APP_URL: ${{ vars.APP_URL }}
```

- Nền tảng có sẵn bước chạy trước khi deploy (vd release command, pre-deploy command) thì đặt migration ở đó thay vì chạy từ runner của GitHub; runner thường không được phép kết nối thẳng tới DB production.
- `concurrency` để hai lần deploy cùng môi trường không chạy chồng nhau. Input `image_tag` đi qua biến môi trường và được kiểm định dạng, không chèn thẳng vào lệnh shell.
- Quyền `packages: write` chỉ cấp cho job build; các job deploy chỉ đọc. Tên image chuyển sang chữ thường vì registry không nhận chữ hoa (`github.repository` giữ nguyên chữ hoa của tên tài khoản).
- Rollback code = chạy lại job production với SHA của bản trước và **bỏ chọn `run_migrations`** (artifact cũ vẫn còn trong registry; DB giữ version mới). Chi tiết: `release-rollback.md` mục 4.
- Smoke test gọi `/health/ready` (readiness, `observability.md`).

## 5. Migration trong pipeline

- Migration là một bước riêng **trước** khi bản code mới nhận traffic, chạy bằng role có quyền DDL, chạy một lần (không phải mỗi instance tự chạy khi khởi động).
- Migration phải tương thích với bản code đang chạy (expand → contract), để lúc deploy lẫn lúc rollback đều không lỗi.
- Migration dài (backfill lớn, tạo index trên bảng lớn) tách thành job riêng, có theo dõi tiến độ; không để pipeline deploy chờ hàng giờ.
- Lỗi migration giữa chừng: pipeline dừng, không deploy code mới.
