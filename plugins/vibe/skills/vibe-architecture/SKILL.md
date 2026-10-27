---
name: vibe-architecture
description: "Write code that follows the codebase's architecture, conventions and logic, and choose a fitting architecture. Use when adding a feature, module, endpoint or screen to existing code (follow its patterns, reuse helpers and error classes, keep module boundaries), entering an unfamiliar codebase, restructuring, choosing/revisiting an architecture (modular monolith, layered, hexagonal/clean, DDD, CQRS, event-driven, microservices, serverless), SOLID/DDD in moderation. Small edits in familiar files: just do them. Also use for Vietnamese requests like 'code theo chuẩn codebase', 'tách module', 'nên dùng kiến trúc gì', 'code bị rối'."
---

# Architecture: code consistent with the codebase

Read only what the current task needs:

| Task | Read |
|---|---|
| Working in an existing codebase, especially the first time: find and follow its conventions | `references/codebase-conventions.md` |
| Choosing an architecture for a new project or module, splitting modules, boundaries | `references/architecture-styles.md` |
| Complex business logic with many rules and states | `references/ddd.md` |
| SOLID, design principles, patterns, code smells, refactoring | `references/design-principles.md` |

**Right-size it**: for a small edit in a familiar file (change a condition, fix text, add a field), follow the surrounding code; don't re-survey the codebase.

## Priority when principles conflict

0. **Never sacrifice security, tenant isolation or data correctness for "consistency".** If an existing pattern lacks tenant scope, lacks a transaction for an operation that must be atomic, swallows errors or has a vulnerability: do it right in your code and tell the user about the old code.
1. **User instructions, `AGENTS.md`, ADRs** in `docs/plan/ARCHITECTURE.md`.
2. **Business requirements**: `docs/domain/DOMAIN.md`, task card.
3. **Patterns already in the codebase**: structure, naming, error reporting, testing. A consistent codebase is easier to read and change than one where every place is "by the book" in its own way.
4. **General principles** (SOLID, DDD, clean architecture): use them to decide where the codebase has no convention, not to rewrite what works.

If you find a **style or structure** convention poor (names, file layout, layering), propose a change to the user and record an ADR. Don't change it piecemeal within a task, or the codebase ends up with two ways to do one thing.

## Always

1. **Read before writing**: find 1–2 places that do something similar and follow their file structure, naming, error reporting, validation and tests.
2. **Reuse before writing new**: search for existing helpers, utils, components, error classes, clients (grep by name and by function). Never add a second way to do the same thing (two date libraries, two HTTP clients, two error styles). For a problem libraries already solve (CSV, dates, validation, retries, sanitizing), use the project's dependency, the platform, or a maintained library; don't hand-roll it (`references/design-principles.md` section 2).
3. **Right layer, right module**; dependencies point one way (e.g. route → service → repository). If the codebase has module boundaries, other modules go through that module's API, not its tables; for many records use a batch read function, and pass `tx` when the operation must share a transaction.
4. **Business logic in one place** (service, domain function, use case), not spread across controllers, UI components or SQL.
5. **Names follow the glossary** in `DOMAIN.md` and the codebase's naming style.
6. **Smallest correct change**: no refactoring outside the task; if something needs cleanup, write a separate task card. One exception: logic your change would copy a third time is extracted now, at the lowest level its callers share (`references/design-principles.md` section 2).
7. **Abstract only on real need**: usually a genuine second variant, a third copy, or a boundary with an external system; not "we might need it later".
8. **Comments say why, never what**: business rules, non-obvious constraints, workarounds with a link. No comments restating the code, no change notes, no commented-out code.
9. **Every architecture recommendation has a concrete, measurable revisit trigger**: what, for which part, why it fits the current team and stage, and when to revisit (e.g. "split notifications into a service when a dedicated team owns it, or when the send queue lags more than 5 minutes at peak"). Record it in an ADR (`references/architecture-styles.md` section 6).

## Before calling it done

- The diff looks written by a teammate: same structure, libraries and style as the neighboring module.
- No hand-written version of what a dependency or the platform already does; a new dependency has a stated reason.
- No logic copied a third time; no reverse or circular imports between modules.
- No comment that only restates the code.
- Lint, format and typecheck pass with the project's config.
- Found an important convention missing from `AGENTS.md`: propose a few lines for the user to approve (only the main session edits `AGENTS.md`; subagents put proposals in their report).
