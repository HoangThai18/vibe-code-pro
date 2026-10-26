# Phases: Product name

| Phase | Goal | Status |
|---|---|---|
| P0 | Foundation running on staging | todo |
| P1 | User flow 1 | todo |
| P2 | User flow 2 | todo |

---

## P0: Foundation
**Goal:** repo, CI, auth, tenancy, app layout, staging deploy. Every later phase builds on this.

**Scope:**
- Monorepo / folder structure, lint, typecheck, test, CI on every PR
- Auth + workspace (tenant) selection, core schema (tenants, users, memberships) + RLS
- App layout (navigation shell), basic design tokens
- Automatic deploy to staging

**Exit criteria (verifiable):**
- [ ] CI runs lint + typecheck + test and blocks the PR on failure
- [ ] Log in, create/select a workspace; data isolated per tenant (tested)
- [ ] Staging auto-deploys from main, with a healthcheck

**Design needed:** layout shell, login screen (Claude Design)

**Risks:** ...

---

## P1: User flow name
**Goal:** one sentence, from the user's point of view.

**Scope:**
- ...

**Exit criteria:**
- [ ] Flow X demoable on staging with real data
- [ ] Tenant isolation tests for every new endpoint
- [ ] ...

**Design needed:** screens ...

**Risks:** ...
