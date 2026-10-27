CREATE TABLE api_keys (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  name         text NOT NULL,                       -- 'Website booking form'
  key_hash     bytea NOT NULL,                      -- SHA-256 of the whole key; the key is shown once
  scopes       text[] NOT NULL CHECK (cardinality(scopes) > 0),   -- Actions from shared/authz.ts
  created_by   uuid NOT NULL REFERENCES users (id),
  expires_at   timestamptz,
  last_used_at timestamptz,                         -- update outside the request transaction (it would lock the row)
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key_hash)
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
