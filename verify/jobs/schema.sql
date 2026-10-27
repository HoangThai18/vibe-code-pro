CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  appointment_id uuid NOT NULL REFERENCES appointments (id),
  kind           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, kind)            -- mỗi lịch hẹn chỉ một lần nhắc mỗi loại
);
CREATE INDEX notifications_tenant ON notifications (tenant_id);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
