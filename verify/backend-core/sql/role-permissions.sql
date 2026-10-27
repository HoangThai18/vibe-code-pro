-- Custom roles: named permissions per role, from a global read-only catalog (the Actions in shared/authz.ts)
CREATE TABLE permissions (key text PRIMARY KEY);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON permissions FROM app_user;
INSERT INTO permissions (key) VALUES
  ('customer.read'), ('customer.write'), ('customer.import'), ('appointment.write'), ('appointment.confirm'),
  ('billing.manage'), ('member.invite'), ('member.role_change'), ('api_key.manage');

CREATE TABLE role_permissions (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant(),
  role_id    uuid NOT NULL,
  permission text NOT NULL REFERENCES permissions (key),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
