-- Set by withMember after the membership check. Read by role-gated policies, never by memberships/tenants policies.
CREATE OR REPLACE FUNCTION app_member_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.member_role', true), '')
$$;

-- Health notes are sensitive data (references/privacy.md section 5): owners and managers only, in the DB too
CREATE TABLE customer_health_notes (
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  customer_id uuid NOT NULL,
  note        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE customer_health_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_health_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY by_role ON customer_health_notes
  USING (tenant_id = (SELECT app_current_tenant()) AND (SELECT app_member_role()) IN ('owner', 'manager'))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()) AND (SELECT app_member_role()) IN ('owner', 'manager'));
