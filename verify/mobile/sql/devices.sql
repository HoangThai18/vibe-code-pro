-- One row per device (push token), not per workspace. Like users, devices are not tenant data:
-- a staff member of two spas has one row, and each spa reaches it through memberships.
CREATE TABLE devices (
  push_token   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
