# spa-api

Multi-tenant booking API for spas. Node 22, Fastify, PostgreSQL 16 with RLS.

- Test: `npm test` (needs `DATABASE_URL`; the app connects as `app_user`, not the table owner)
- Migrations: `db/migrations/NNNN_name.sql`, run in order by `npm run migrate`
- Every tenant route is `/v1/t/:tenantId/...` and runs its queries through `withTenant` (`src/db.js`)
