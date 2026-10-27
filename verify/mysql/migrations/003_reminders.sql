-- One reminder of each kind per appointment (references/jobs.md), and a job table workers claim with SKIP LOCKED
CREATE TABLE notifications (
  tenant_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id             CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  appointment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind           VARCHAR(30) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at        DATETIME(3),
  created_at     DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY notifications_once (tenant_id, appointment_id, kind),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE jobs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,   -- internal, never in an API
  tenant_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  queue        VARCHAR(50) NOT NULL,
  payload      JSON NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'dead')),
  run_at       DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  attempts     INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3),
  last_error   VARCHAR(1000),
  KEY jobs_ready (queue, status, run_at)   -- without it, one worker's claim locks every queued row
);
