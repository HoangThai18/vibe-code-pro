# Test strategy and E2E

Tests reduce risk; a coverage number is not the goal. Ask: "if this breaks, what do we lose, and which test level catches it most cheaply?"

## Contents
1. Choose the test level by kind of logic
2. Integration with a real DB
3. E2E with Playwright
4. Test data
5. Flaky tests
6. Tests in CI
7. `docs/TESTING.md`

## 1. Choose the test level by kind of logic

| Logic | Level | Why |
|---|---|---|
| Pure calculation (price, discount, rounding, slug, state machine) | Unit | Fast, many edge cases |
| Queries, transactions, migrations, RLS, DB constraints | Integration with a real DB | A mocked DB misses SQL errors, constraints, RLS |
| Endpoints: validation, authorization, tenant isolation, error format | Integration over HTTP (supertest, httpx...) | Checks the real API contract |
| BE ↔ FE contract | Validate responses with the shared schema | Catches contract drift early |
| Components with logic (forms, filter tables) | Component test + MSW | No need to boot the whole app |
| Key user flows (sign-up, booking, payment) | E2E, only a few | Catches integration bugs between parts |

Never mock the thing under test. Every bug fix comes with a test that reproduces the bug: fails before the fix, passes after.

## 2. Integration with a real DB

- Run Postgres in a container (Testcontainers or docker compose), same major version as production.
- On each run, migrate the test DB from scratch, which also tests the migrations.
- Run tests as a **role like the app's** (not superuser); otherwise RLS is bypassed and tests pass falsely.
- Isolate tests: roll back a transaction after each test, or prefix data per test. In parallel runs, one database or schema per worker.

## 3. E2E with Playwright

Only for the few flows that matter most (login, the main value-creating flow, payment, role-based permissions, workspace switching); each phase adds its own flows. Config, per-role login, data fixtures, multi-role flows, server vs browser time, network mocks, screenshots, a11y, debugging and CI: `references/e2e-playwright.md`.

## 4. Test data

- Each test creates the data it needs (via API or fixture) with unique names; never rely on data left by other tests or on run order.
- Shared seed (accounts, tenants A/B) comes from an idempotent script run before the E2E suite.
- Never run E2E against production. Staging uses fake or anonymized data.

## 5. Flaky tests

Common causes: fixed-time waits, data shared between tests, order dependence, animations, time zone/current date, real external services.

- Fix the root cause: auto-waiting assertions, per-test data, fixed time (fake timers, one consistent `TZ=Asia/Ho_Chi_Minh` or UTC), mocked external services.
- Prove the flakiness is gone: run repeatedly and in parallel (Playwright: `--repeat-each=5 --workers=4`; Vitest/Jest: run the test file in a shell loop).
- A test you can't fix now: skip it **with a task card** for the fix and a deadline. Never raise retries to hide it.

## 6. Tests in CI

- Every PR: lint, typecheck, unit, integration (with a DB service), build. These are required checks before merge.
- E2E: on PRs for key flows, or nightly and before release if the suite is slow. Keep the report and trace on failure.
- Sample pipeline: the `vibe-ship` skill (`references/ci-cd.md`).

## 7. `docs/TESTING.md`

For the team and agents: the command for each test type, how to set up the test DB, sample accounts and tenants, which flows have E2E, naming conventions. Add the commands to `AGENTS.md`.
