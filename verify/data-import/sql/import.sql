-- Natural key. Live table: CONCURRENTLY, outside a transaction; fails if duplicates already exist
CREATE UNIQUE INDEX CONCURRENTLY customers_tenant_phone ON customers (tenant_id, phone);

CREATE TABLE import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  kind        text NOT NULL CHECK (kind IN ('customers')),
  file_sha256 text NOT NULL,
  file_name   text NOT NULL,                       -- display only
  header      jsonb NOT NULL,                      -- header cells, reused by the error report
  status      text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'queued', 'applying', 'done', 'failed')),
  on_conflict text NOT NULL DEFAULT 'skip' CHECK (on_conflict IN ('skip', 'update')),
  total_rows  int  NOT NULL,
  valid_rows  int  NOT NULL,
  next_row    int  NOT NULL DEFAULT 0,             -- resume point: last Excel row applied
  inserted    int  NOT NULL DEFAULT 0,
  updated     int  NOT NULL DEFAULT 0,
  skipped     int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, kind, file_sha256),           -- the same file twice = the same batch
  UNIQUE (tenant_id, id)
);

-- Parsed rows between preview and apply: personal data, purged (apply.ts, purgeBatch)
CREATE TABLE import_rows (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant(),
  batch_id   uuid NOT NULL,
  row_number int  NOT NULL,                        -- as the user sees it in Excel
  data       jsonb,                                -- normalized values; NULL when rejected
  raw        jsonb,                                -- original cells, rejected rows only
  errors     jsonb,                                -- [{ "column": "SĐT (B)", "message": "..." }]
  PRIMARY KEY (batch_id, row_number),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batches (tenant_id, id) ON DELETE CASCADE
);

-- Same migration: ENABLE + FORCE RLS and the tenant_isolation policy on both tables (references/postgres-rls.md section 2)
