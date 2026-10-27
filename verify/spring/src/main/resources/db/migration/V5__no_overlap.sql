-- A staff member never has two overlapping appointments; cancelled ones don't count.
-- tstzrange is [starts_at, ends_at): 10:00-11:00 and 11:00-12:00 don't overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- lets the gist index compare uuids with =
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, staff_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status <> 'cancelled');
