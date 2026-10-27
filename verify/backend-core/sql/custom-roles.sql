-- Roles each tenant defines, e.g. 'Lễ tân ca tối'. One role per member.
CREATE TABLE roles (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_owner   boolean NOT NULL DEFAULT false,      -- holds every permission; never edited or deleted
  data_scope text NOT NULL DEFAULT 'tenant' CHECK (data_scope IN ('own', 'branch', 'tenant')),   -- section 4
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX roles_one_owner ON roles (tenant_id) WHERE is_owner;

CREATE TABLE member_roles (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
  user_id   uuid NOT NULL,
  role_id   uuid NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id)   -- composite: only this tenant's roles
);
CREATE INDEX member_roles_role ON member_roles (tenant_id, role_id);

-- The DB backs up the code: the owner role stays as created
CREATE FUNCTION protect_owner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the owner role cannot be changed or deleted';
END $$;
CREATE TRIGGER roles_owner_locked BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW WHEN (OLD.is_owner) EXECUTE FUNCTION protect_owner_role();

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_roles
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
