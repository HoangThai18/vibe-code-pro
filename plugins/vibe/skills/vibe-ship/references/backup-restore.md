# Backup and restore

A backup never test-restored is only a hope. Design backwards from the question: "If we lost the DB at 3 p.m. today, how much data could we lose and how long could we wait?"

## Contents
1. RPO and RTO
2. Postgres: backup layers
3. Basic commands
4. Tables with FORCE RLS
5. Restore and restore drills
6. Partial and per-tenant restore
7. Files and object storage
8. Security and retention

## 1. RPO and RTO

- **RPO**: the maximum data loss you accept (e.g. 5 minutes).
- **RTO**: the maximum downtime you accept (e.g. 1 hour).
- Record both in ARCHITECTURE.md. They decide whether you need PITR or just a daily dump, and whether you need a copy in another region.

## 2. Postgres: backup layers

| Layer | Covers | Notes |
|---|---|---|
| Automatic backups + PITR of a managed DB (RDS, Cloud SQL, Neon, Supabase...) | Restore to any point within the retention window; RPO of minutes | Enable from day one; check the retention window of your plan |
| Periodic logical dump (`pg_dump`) to separate storage (another account or region) | Loss of the whole account/provider, an accidentally dropped DB, needing data older than the PITR window | Follow 3-2-1: 3 copies, 2 storage types, 1 off-site |
| Read replica | Availability | **Not a backup**: an accidental delete replicates too |

Self-managed Postgres (VPS): use a backup tool with WAL archiving and PITR (e.g. pgBackRest, WAL-G) instead of just a `pg_dump` cron.

## 3. Basic commands

`pg_dump` contains one database and **no roles**. Restoring onto a new server without the roles breaks ownership, GRANTs and role-based policies. So back up both:

```bash
# 1. Roles (without passwords; managed DBs usually don't allow reading them)
pg_dumpall --roles-only --no-role-passwords --file=roles-$(date +%F).sql --dbname="$ADMIN_URL"

# 2. Database in custom format (compressed, selectively restorable), KEEPING owner info
pg_dump --format=custom --file=app-$(date +%F).dump "$BACKUP_DATABASE_URL"

# List the dump's contents
pg_restore --list app-2026-10-25.dump | head
```

- `BACKUP_DATABASE_URL` uses a dedicated backup role: `BYPASSRLS` + `pg_read_all_data` (section 4). A role with per-table GRANTs makes `pg_dump` fail with `permission denied` as soon as a new table appears.
- Encrypt files before uploading to storage; limit who can download them.

## 4. Tables with FORCE RLS

Tables with `FORCE ROW LEVEL SECURITY` apply policies to the owner too, so `pg_dump` as the owner fails with `query would be affected by row-level security policy`. Dump with a backup role that has `BYPASSRLS` and `pg_read_all_data` (e.g. `app_backup`, the `vibe-backend` skill, `references/postgres-rls.md` section 1).

## 5. Restore and restore drills

**A restore must keep the original owners.** Restoring with `--no-owner` makes every table belong to the restoring user: later migrations as the old owner role fail with "must be owner", and since the restoring user is now the owner, `FORCE` filters out every row. Procedure:

1. On a new server, create roles first: run `roles-*.sql` (ignore "role already exists" lines), reset passwords for login roles.
2. Create the target database **with the same owner as the original**, so schema `public` belongs to the right role:
   ```sql
   CREATE DATABASE restore_check OWNER app_owner;
   ```
3. Restore as superuser (self-managed server), or on a managed DB as an admin user that **is a member** of the object-owning roles (`GRANT app_owner TO <admin>`), **without** `--no-owner`:
   ```bash
   pg_restore --dbname="$RESTORE_URL" app-2026-10-25.dump
   ```
   Read the warning at the end: `errors ignored on restore: N` with N not 0 means the restore failed; check each error.
4. Check after restore:
   - Table and function owners match the original (`\dt+`, `\df+`, or query `pg_tables`, `pg_proc`).
   - The RLS check queries in the `vibe-backend` skill (`references/postgres-rls.md` section 8) return nothing (every table with `tenant_id` still has RLS + `FORCE`, the app role doesn't bypass).
   - Row counts of the main tables, using the backup role, match the original at the same point in time.
   - Run the app against the restored DB, log in with a test account, open a few main screens.

**Drill** at least monthly (and after every major infrastructure change): do all 4 steps above with the latest backup (or a PITR to a point in time) into a separate environment, and record the actual time against the RTO in `docs/ops/restore-drills.md`. Slower than RTO or any failed step: create a task card to fix it right away.

## 6. Partial and per-tenant restore

The common incident isn't losing the whole DB but one tenant's data deleted or changed by mistake:

- Restore the backup (or PITR to before the error) into a temporary DB.
- Extract exactly what's needed (`WHERE tenant_id = ...`, the right tables) and copy it back to production with a reviewed script, in a transaction, checking row counts before and after.
- Never restore over all of production for one tenant: every other tenant loses its new data.
- Keep per-tenant export and import scripts ready: they serve both recovery and customers' data export requests.

## 7. Files and object storage

- Enable versioning on buckets holding user files, with lifecycle rules (delete old versions after N days).
- Replicate to another region or account if RPO/RTO require it.
- DB and file backups must line up in time within acceptable limits (DB metadata points to files that still exist).

## 8. Security and retention

- Backups hold all customer data: encrypt them, restrict access tightly, log access.
- Retention follows business needs and personal data protection rules; data of customers who requested deletion stays in old backups until those expire, so state this in the policy.
- Monitor backups: a failed backup job must alert (`references/observability.md`).
