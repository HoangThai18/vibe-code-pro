# API contract: lock the BE ↔ FE agreement before coding

When BE and FE (or two subagents) work in parallel, the contract is the only thing keeping them in sync. Without it each side guesses field names, error codes and pagination, and next week you spend fixing mismatches.

## 1. Pick one source of truth

Based on the current stack:

- **TypeScript on both sides (monorepo)**: zod / valibot / TypeBox schemas in a shared package (e.g. `packages/contracts`). One schema gives both types and runtime validation on both sides.
- **BE in another language, or several clients (web, mobile, partners)**: OpenAPI 3.1 (`docs/contracts/openapi.yaml`), generate clients/types from it.
- **tRPC / GraphQL**: the schema is the contract; the conventions below still apply.

Keep only one source. Hand-written types plus OpenAPI drift apart sooner or later.

## 2. Endpoint design

For each flow in the phase, record: resource, method, path, request, response, possible errors, required permission. Default conventions (naming, error format, pagination, time, money, idempotency) and zod/OpenAPI/MSW templates are in `references/api-conventions.md`. Read it when writing the project's first contract, then record a summary of the chosen conventions in `AGENTS.md`.

Most common mistakes:

- **The tenant is in the path and checked on the server** (`/v1/t/{tenantId}/...`): every request checks the user is a member of that tenant, otherwise 404. Never accept `tenantId` from body/query or rely on an implicit "current tenant" in the session (`references/api-conventions.md` section 5).
- **Lists are always paginated and capped** (e.g. `limit` max 100). No "return everything" endpoint.
- **One error format**, with a machine-readable `code` so FE handles each case (e.g. `customer_email_taken`) without parsing message text.
- **Another tenant's resource returns 404**, not 403, so its existence isn't revealed.
- **Create operations with side effects** (payments, emails, orders) accept an `Idempotency-Key` header, since flaky networks make clients resend.
- **IDs are strings** (UUID/ULID); never expose auto-increment IDs.

## 3. Tooling for both sides

- **FE**: mock handlers (e.g. MSW) and fixtures taken from the contract's examples, so FE can finish the UI before BE is done.
- **BE**: contract tests checking real responses against the schema (validate with the shared schema itself, or an OpenAPI validator).
- **Example payloads** per endpoint, happy path and errors. Both documentation and fixtures.

## 4. Changing the contract

- **Safe**: add an optional field, add an endpoint, add an enum value old clients can ignore.
- **Breaking**: rename or remove a field, change a type or meaning, make an optional field required. Needs a new version or a deprecation path, and notify every task using that endpoint.
- If the contract changes while agents run in parallel, stop the affected tasks, update the contract and task cards, then resume. Letting each agent patch things its own way causes drift.

## Output

- Contract file (shared schema or `openapi.yaml`) + examples + mocks.
- `docs/contracts/README.md`: endpoint table (method, path, description, permission) for quick lookup by people and agents.
- The contract task card goes in the phase's first wave; BE/FE tasks using it declare `deps` on it.
