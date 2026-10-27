-- UNLOGGED: faster, loses data if Postgres crashes (fine for counters); a job purges old rows hourly
CREATE UNLOGGED TABLE rate_limits (
  key          text        NOT NULL,   -- e.g. 'login:ip:1.2.3.4', 'ai:user:<uuid>'
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  PRIMARY KEY (key, window_start)
);
-- Purge: DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
