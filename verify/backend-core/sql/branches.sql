CREATE TABLE branches (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id        uuid NOT NULL DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
-- Which branches a member works at (used when the role's data_scope is 'branch' or 'own')
CREATE TABLE member_branches (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
  user_id   uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, user_id, branch_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE customers ADD COLUMN branch_id uuid,
  ADD FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id);
ALTER TABLE appointments ADD COLUMN branch_id uuid,
  ADD FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id);
CREATE INDEX customers_branch ON customers (tenant_id, branch_id);
CREATE INDEX appointments_branch ON appointments (tenant_id, branch_id);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
ALTER TABLE member_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_branches
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

-- Scope variables, set by withMemberPermissions (or a job, explicitly)
CREATE FUNCTION app_data_scope() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.data_scope', true), '')
$$;
CREATE FUNCTION app_branch_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT string_to_array(NULLIF(current_setting('app.branch_ids', true), ''), ',')::uuid[]
$$;
CREATE FUNCTION app_actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;
