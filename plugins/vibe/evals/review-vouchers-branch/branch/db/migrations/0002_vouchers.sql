SET lock_timeout = '5s';

-- Gift vouchers: a spa sells a code, the customer redeems it at a later visit.
CREATE TABLE vouchers (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  customer_id uuid,
  amount bigint NOT NULL CHECK (amount > 0),
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY vouchers_tenant ON vouchers
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
