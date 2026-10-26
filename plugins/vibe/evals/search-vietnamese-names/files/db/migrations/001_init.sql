CREATE TABLE tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);

CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE customers (
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text NOT NULL,                 -- stored as 0912345678
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_tenant_name ON customers (tenant_id, full_name, id);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
