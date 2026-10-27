# spa-api

- Node 22, TypeScript, mysql2, MySQL 8.4 (InnoDB, one primary, one replica for reports). No RLS: every query filters `tenant_id`.
- Migrations: plain SQL files in `db/migrations/`, applied in order by `npm run migrate` (scripts/migrate.ts) during deploy, never edited after they ran.
- Jobs: `src/jobs/export-appointments.ts` runs at 02:00 Asia/Ho_Chi_Minh on the primary and takes about 15 minutes.
- Deploys happen any time of day.
