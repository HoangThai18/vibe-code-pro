-- Test setup only (not in the doc)
CREATE TABLE appointments (
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  starts_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'booked',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);
CREATE INDEX appointments_day ON appointments (tenant_id, starts_at);
