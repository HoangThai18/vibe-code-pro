# Tenant isolation tests

Goal: prove with tests that tenant A cannot read, update, delete or list tenant B's data, through the API and directly in the DB. Write table-driven tests so a new route gets a test by adding one row. The tests below ran (vitest 5, supertest, Express 5, PostgreSQL 16 as the app role) against routes built on `withMember`.

## 1. Seed two tenants

```ts
{{test/helpers/tenants.ts}}
```

Seed through app code (or SQL with the correct tenant context), never by inserting as a superuser that skips constraints; only then do tests reflect the real path. `createTenantWithUser` signs up a user and a tenant (`createTenant`, `references/postgres-rls.md` section 4) and logs in; `createCustomer` calls the API.

## 2. Table-driven API tests with controls

The tenant is in the path (`/v1/t/{tenantId}/...`, `references/api-conventions.md` section 5), so there are **two** attack paths to block: putting B's id in A's own path (blocked by tenant scope/RLS), and calling B's path directly (blocked by the membership check).

Isolation tests also pass easily while checking nothing: a route with a wrong path returns 404 too, and an empty list also "contains none of B's data". So every negative check comes with a **positive control**: the same request by the owner must succeed.

```ts
{{test/customers.isolation.test.ts}}
```

Stricter: read the route list from the app's router and assert every route with `:id` is in `crossTenantRoutes`, so a new route without a test turns CI red.

## 3. Testing RLS directly in the DB

Run as the **app role** (not superuser):

```sql
{{sql/isolation-check.sql}}
```

(`:'tenant_a'` is psql variable syntax: `psql -v tenant_a=... -v tenant_b=...`. In test code, pass parameters normally.)

## 4. Checklist for each new table or endpoint
- [ ] Cross-tenant read / update / delete → 404 via both paths (B's id in A's path; B's path), with a control: the owner making the same request succeeds
- [ ] Lists include the current tenant's data and none of other tenants'
- [ ] `tenantId` from the client is ignored
- [ ] Cross-tenant references are rejected (composite FK)
- [ ] The new table is absent from the RLS check query results in `references/postgres-rls.md` section 8
- [ ] Tests run as the app role, not superuser
