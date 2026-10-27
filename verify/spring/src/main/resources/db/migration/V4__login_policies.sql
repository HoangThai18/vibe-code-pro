CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (tenant_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user()));
CREATE POLICY membership_insert ON memberships FOR INSERT
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_delete ON memberships FOR DELETE
  USING (tenant_id = (SELECT app_current_tenant()));

-- tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenants FOR SELECT
  USING (id = (SELECT app_current_tenant())
         OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = (SELECT app_current_user())));
CREATE POLICY tenant_insert ON tenants FOR INSERT
  WITH CHECK (id = (SELECT app_current_tenant()));
CREATE POLICY tenant_update ON tenants FOR UPDATE
  USING (id = (SELECT app_current_tenant()))
  WITH CHECK (id = (SELECT app_current_tenant()));
CREATE POLICY tenant_delete ON tenants FOR DELETE
  USING (id = (SELECT app_current_tenant()));
