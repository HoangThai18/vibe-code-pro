CREATE TABLE notifications (
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  kind           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, appointment_id, kind)          -- one reminder of each kind per appointment
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
