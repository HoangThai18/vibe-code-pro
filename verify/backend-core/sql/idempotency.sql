CREATE TABLE idempotency_keys (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  key          text NOT NULL CHECK (length(key) BETWEEN 8 AND 255),
  request_hash bytea NOT NULL,                   -- SHA-256 of method, path and body
  status       smallint NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX idempotency_keys_created ON idempotency_keys (tenant_id, created_at);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
