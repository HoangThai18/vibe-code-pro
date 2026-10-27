# spa-api

- Node 22, TypeScript, mysql2, MySQL 8.4 (InnoDB). No RLS: every query filters `tenant_id` from the request path.
- Migrations: plain SQL files in `db/migrations/`, applied in order on deploy, never edited after they ran.
- Phones are stored normalized as `0912345678`.
