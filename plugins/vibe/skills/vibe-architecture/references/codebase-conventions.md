# Follow the codebase's conventions

Goal: new code matches old code so closely that a reader can't tell which part the AI wrote. "Correct" code in a foreign style is still debt: the next person must learn two ways, and the two drift apart.

## Contents
1. First survey of the codebase
2. Record the conventions
3. Writing new code
4. When the codebase is inconsistent
5. When the existing pattern is wrong
6. Legacy code
7. Final checklist

## 1. First survey of the codebase (10–20 minutes, once)

- Read `README`, `AGENTS.md` (or `CLAUDE.md`), `docs/`, config files (package.json/pyproject, tsconfig, eslint/prettier, CI).
- Folder structure: by feature (`modules/customers/...`) or by layer (`controllers/`, `services/`...)? In a monorepo, which packages exist and how do they depend on each other?
- Run the existing tests and lint **before changing anything**, to know the baseline (tests already failing aren't yours).
- Trace **one full request**: route → middleware (auth, tenant) → handler/controller → service → repository/ORM → DB → response and error formatting. Every new feature follows this backbone.
- Large codebase: finding definitions and call sites by symbol (an LSP-based tool, e.g. Claude Code's `LSP` tool when an LSP plugin is installed) is more reliable than text grep, especially before renaming or changing a function signature. Setup: the `vibe-plan` skill (`references/dev-tools.md` section 9).
- Find the convention for each aspect:

| Aspect | Questions |
|---|---|
| Naming | files (kebab, camel, `.service.ts`?), functions, classes, variables, tables, columns, routes |
| Module structure | which files a module has, what it exports |
| Dependency injection | constructor, container (NestJS, tsyringe), module-level singleton, function parameters |
| Validation | where (route schema, DTO, service), with what (zod, class-validator, pydantic) |
| Errors | custom error classes with a `code`? Result type? Where errors map to HTTP? |
| Data access | separate repository or ORM calls directly in services? At which layer do transactions open? |
| Logging, config | which logger, where config is read from |
| Tests | location, framework, factories/fixtures, what gets mocked |
| Frontend | component structure, styling, data fetching, state, forms |
| Format and lint | formatter (Prettier, Black, gofmt), linter, pre-commit hooks (husky, lint-staged, pre-commit); run the project's commands instead of formatting your own way |
| Imports | path aliases (`@/`), relative or absolute imports, import order, barrel files (`index.ts`) |
| Generated code | Prisma client, OpenAPI client, GraphQL types, migration files: **never edit by hand**; change the source and run the generate command |
| Language | are variable names, comments, error messages, commits in Vietnamese or English |
| Type strictness | `strict`, is `any` allowed, null handling |

## 2. Record the conventions

Propose 10–20 lines for the "Conventions" section of `AGENTS.md`, with a path to a model module, and write them only after the user approves. Only the main session edits `AGENTS.md`; subagents put proposals in their report instead of editing, so parallel agents never write the same file. Record only what can't be inferred from the code. Example:

```markdown
## Conventions
- Modules by feature: `src/modules/<name>/{<name>.routes.ts, <name>.service.ts, <name>.repository.ts, <name>.schema.ts}`. Reference module: `src/modules/customers/`.
- Business errors: `throw new AppError('customer_email_taken', 409)` from `src/shared/errors.ts`; routes don't catch errors, the shared middleware does.
- Validate input with the zod schema in `<name>.schema.ts`, reused by the frontend via `packages/contracts`.
- Repositories take `tx` as the first parameter; services open the transaction with `withTenant()`.
- Tests: `*.test.ts` next to the source file; data via `test/factories`; don't mock repositories in service tests, use the test DB.
```

Every agent reads `AGENTS.md` (Claude Code reads `CLAUDE.md`, which contains `@AGENTS.md`), so writing it once serves the whole team and every later session.

## 3. Writing new code

- **Find the most similar feature** and do it its way: file layout, function signatures, naming, test style. Building "supplier"? Look at "customer". Building a list screen? Look at an existing list screen.
- **Use the libraries already in use** for the same job. To add a new library, ask the user and give a reason.
- **Reuse shared infrastructure**: error classes, logger, config, HTTP client, UI components, money and date formatting. Grep before writing a new helper.
- **Keep boundaries (if the codebase has module boundaries)**: for another module's data, call that module's public API; never query its tables directly. For many records, use (or add) a batch read function instead of fetching one by one in a loop; if the operation must share a transaction, pass `tx`. In a Rails/Django-style codebase where joining across apps via the ORM is the convention, follow that convention.
- **Test in the existing style** (file location, data setup, level of mocking).

## 4. When the codebase is inconsistent

- Two ways coexist? Choose in this order: (1) the direction recorded in `AGENTS.md`, an ADR or the project's migration docs; (2) the **newer** way (check `git log`), usually where the team is heading; (3) still unclear: ask the user one question with two concrete options.
- Brand-new module: follow the closest module by function.
- Don't mass-fix the old spots in the current task; note them and propose a separate cleanup task.

## 5. When the existing pattern is wrong

If a pattern has a real bug (security hole, missing tenant scope, missing transaction for an operation that must be atomic, N+1, swallowed errors), **don't copy the bug into new code**. Do it right in your part, tell the user about the old spot, propose a fix task. This is item 0 in SKILL.md's priority order: security and correctness always beat consistency.

## 6. Legacy code

- Before changing untested code: write a **characterization test** that records current behavior, odd behavior included, so you know whether you changed anything.
- Change in small steps, each committable with tests passing.
- For a large rewrite use the strangler pattern: build the new part alongside, move traffic over gradually, delete the old part once nothing uses it. Never rewrite everything at once.
- Keep refactor commits (no behavior change) separate from feature commits, for easier review and revert.

## 7. Final checklist

- [ ] New files are in the right place, named like files of the same kind
- [ ] Reuses existing error classes, logger, helpers, components; no library duplicating existing functionality
- [ ] Business logic in the business layer, not in controllers, components or scattered SQL
- [ ] No reverse or circular imports; no direct reads of another module's tables
- [ ] Tests in the same style as existing tests
- [ ] No hand edits to generated code; imports and path aliases match the project
- [ ] Lint, format and typecheck pass with the project's config; tests that passed before still pass
