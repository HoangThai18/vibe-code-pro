-- Test setup only (not in the doc)
CREATE TABLE appointments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  starts_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'booked'
);
CREATE INDEX appointments_day ON appointments (tenant_id, starts_at);
