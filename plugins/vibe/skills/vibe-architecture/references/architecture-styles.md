# Choosing an architecture style

There is no best architecture, only one that fits team size, domain complexity, operational needs and product stage. Too complex too early, and you pay every day for a benefit that hasn't arrived; too simple, and you rewrite when you grow. The safe path: start simple with **clear boundaries**, split later when needed.

## Contents
1. Comparison
2. Questions to choose
3. Recommended default
4. Modular monolith: module boundaries
5. Sample folder structure
6. Recording the decision

## 1. Comparison

| Style | Fits when | Cost | Avoid when |
|---|---|---|---|
| **Layered** (route → service → repository) | CRUD-heavy app, small team, moderate business logic | Easily becomes a "giant service" without modules | Very complex domain with intertwined rules |
| **Modular monolith** (modules by business area, each with its own layers) | Most SaaS in early and middle stages; 1 to a few teams | Needs boundary discipline (lint can enforce it); one overloaded part can drag down the whole app | One part needs very different scaling or tech from day one (video processing, ML), or many large teams need independent deploys |
| **Hexagonal / Clean** (ports & adapters: business core independent of framework, DB, external services) | Complex, long-lived core; many replaceable integrations (payments, AI, email) | More layers and interfaces; slower for simple CRUD | App is mostly form ↔ table |
| **DDD** (bounded context, aggregate, value object, domain event) | Complex domain, many rules, domain experts available, many subdomains | Takes time to learn the domain; many concepts | Simple CRUD; team doesn't understand the domain yet |
| **CQRS** (separate write and read models) | Reads and writes differ a lot (dashboards, reports, complex search) | Cheap version: separate query functions or SQL views on the same DB, nearly free. Full version: separate read store synced via events, with lag and sync to manage | Read screens are ordinary lists and details (full version) |
| **Event-driven** (domain events, outbox, queue, worker) | Side effects to decouple from the main flow (email, notifications, syncing other systems), long tasks | Hard to debug; must handle ordering, duplicates, idempotency | Everything needs a result within the same request |
| **Microservices** | Many independent teams needing separate deploys and scaling; clear, stable domain boundaries | Heavy operations, distributed transactions, network failures, hard observability | Small team, product still finding direction (monolith first) |
| **Serverless functions** | Spiky load, event processing, webhooks, cron | Cold starts, execution time limits, DB connection limits, vendor lock-in | Sustained heavy workloads, long-lived DB connections |

These styles combine. A typical system: modular monolith, a few complex modules inside using DDD/hexagonal, plus event-driven for side tasks.

## 2. Questions to choose

| Question | If... | Then... |
|---|---|---|
| How many people, how many teams in parallel? | 1–8 people, 1–2 teams | Monolith (modular). Microservices only when many teams need independent deploys |
| Mostly CRUD, or complex domains (pricing, booking, receivables, approvals)? | Complex domain | DDD-lite / hexagonal **for that domain only**; CRUD parts stay layered |
| Which external integrations might be replaced (payments, AI, SMS/Zalo)? | Some | Port + adapter at that boundary |
| Do reads and writes differ a lot (reports, dashboards)? | Yes | Cheap CQRS: separate queries, SQL views; a separate read store when measurements show the need |
| Long tasks or side effects (messaging, sync)? | Yes | Outbox + worker (event-driven for that part) |
| Which part needs very different scaling or tech (video, ML, heavy reports)? | Yes, and measurable | Split that part into a service/worker; the rest stays a monolith |
| Spiky load, mostly event processing? | Yes | Serverless for that part; watch DB connection limits |
| Anyone on the team running operations? Budget? | No / low | Managed platforms, as few components as possible |

Non-functional requirements also drive architecture; ask early:
- **Availability**: how much downtime is acceptable? Multi-region?
- **Personal data and data residency**: Vietnamese rules on personal data protection and in-country data storage may affect the choice of provider and server region; ask legal when the customer is a large enterprise or the data is sensitive.
- **Customer isolation**: shared schema or separate DB (the `vibe-backend` skill, `references/multi-tenant.md`).
- **RPO/RTO**: affects backup and deployment (the `vibe-ship` skill, `references/backup-restore.md`).

## 3. Recommended default

For small to mid-sized teams building SaaS (including multi-tenant):

- **Modular monolith**, modules by business area (customers, booking, billing...), each simple layered inside.
- **Hexagonal only at external boundaries**: `PaymentGateway`, `AiProvider`, `Notifier` interfaces + one adapter per provider, to swap or mock in tests.
- **DDD only for complex core domains** (e.g. booking with cancellation, deposit and no-show rules; billing with pricing and discounts): value objects, aggregates, state machines. Other CRUD modules stay simple.
- **Event-driven via outbox** for side effects (messaging, sync); a separate worker for long tasks.
- Split out a service only with measured evidence (load, team, deploy cadence), and only when that module already has clean boundaries.

## 4. Modular monolith: module boundaries

- Each module **owns its tables**; other modules access them only through its service or public API (the `index.ts` it exports), never by querying them directly.
- No circular dependencies between modules; the shared module (`shared`) never imports back into business modules.
- Enforce with tools, not reminders: `eslint-plugin-boundaries`, `dependency-cruiser`, the `import/no-cycle` rule, or Nx `enforce-module-boundaries` (JS/TS); `import-linter` (Python); `ArchUnit` (Java). Check the tool's current docs for configuration before using it.
- Between modules: direct function calls for queries that need an immediate result; domain events (via outbox) for reactions that can wait.

## 5. Sample folder structure

```text
apps/api/src/
├── modules/
│   ├── customers/            # CRUD: simple layered
│   │   ├── customers.routes.ts
│   │   ├── customers.service.ts
│   │   ├── customers.repository.ts
│   │   ├── customers.schema.ts
│   │   └── index.ts          # module's public API
│   └── booking/              # complex core domain: DDD-lite
│       ├── domain/           # entities, value objects, state machine, rules (no framework/ORM imports)
│       ├── application/      # use cases: orchestration, transactions, port calls
│       ├── infrastructure/   # repositories, adapters
│       ├── booking.routes.ts
│       └── index.ts
├── shared/                   # errors, logger, config, db, tenant context
└── integrations/             # adapters for external services: payment, ai, sms
```

Frontend: split by feature (`features/customers/...`) with components, hooks and schemas side by side; shared parts go in `components/ui`, `lib`.

## 6. Recording the decision

Record it in the ADR table of `docs/plan/ARCHITECTURE.md`: which style, for which part, why, rejected options, when to revisit (e.g. "split billing into a service when it gets a dedicated team or load exceeds X").
