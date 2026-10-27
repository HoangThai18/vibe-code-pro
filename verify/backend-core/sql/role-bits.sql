-- Bitmask per module ("ma trận phân quyền"): view=1, create=2, update=4, delete=8, export=16, approve=32
CREATE TABLE modules (key text PRIMARY KEY);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON modules FROM app_user;
INSERT INTO modules (key) VALUES ('customer'), ('appointment'), ('invoice'), ('report'), ('member');

CREATE TABLE role_module_access (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
  role_id   uuid NOT NULL,
  module    text NOT NULL REFERENCES modules (key),
  bits      integer NOT NULL CHECK (bits BETWEEN 0 AND 63),   -- a 7th bit: this CHECK, the view and BIT change
  PRIMARY KEY (tenant_id, role_id, module),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE role_module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_module_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_module_access
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

-- Bits are unreadable in SQL: support and reports read this view
CREATE VIEW role_access_matrix WITH (security_invoker = true) AS
SELECT tenant_id, role_id, module,
       (bits & 1) <> 0 AS can_view, (bits & 2) <> 0 AS can_create, (bits & 4) <> 0 AS can_update,
       (bits & 8) <> 0 AS can_delete, (bits & 16) <> 0 AS can_export, (bits & 32) <> 0 AS can_approve
  FROM role_module_access;
