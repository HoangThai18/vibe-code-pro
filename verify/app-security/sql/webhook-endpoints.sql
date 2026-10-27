-- Outgoing webhooks: the customer's URL and the secret we sign payloads with (auth.md section 7)
CREATE TABLE webhook_endpoints (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  url           text NOT NULL,                   -- checked as in section 3 on save and on every send
  secret_sealed bytea NOT NULL,                  -- sealSecret(signing secret, key)
  key_version   smallint NOT NULL,               -- which key sealed it; rotation re-seals older versions
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_endpoints
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
