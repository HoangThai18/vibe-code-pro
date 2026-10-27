# spa-saas

SaaS đặt lịch và CRM cho spa. Node 22 + Express, PostgreSQL 16 (FORCE RLS, tenant trong path `/v1/t/:tenantId/...`).

- Test: `npm test`
- Mỗi request chạy trong `withMember(pool, tenantId, userId, fn)` (`src/db/tenant.js`): đặt tenant, kiểm membership.
- Quyết định kiến trúc ghi ở `docs/plan/ARCHITECTURE.md`.
