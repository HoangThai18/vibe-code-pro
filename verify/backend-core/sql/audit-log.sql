CREATE TABLE audit_log (
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id              bigint GENERATED ALWAYS AS IDENTITY,
  actor_type      text NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
  actor_id        text NOT NULL,             -- user id, API key id, or job name
  impersonator_id uuid,                      -- support staff acting as actor_id (section 8)
  action          text NOT NULL,             -- an Action ('member.role_change') or an event ('auth.login_failed')
  entity          text NOT NULL,
  entity_id       text,
  diff            jsonb NOT NULL DEFAULT '{}',   -- before/after for permission and price changes
  ip              inet,
  user_agent      text,
  at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity, entity_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
-- Append-only: the default privileges (postgres-rls.md section 1) granted UPDATE and DELETE too.
-- Retention purges run as app_maintenance.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;
