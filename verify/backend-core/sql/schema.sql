-- The example schema every reference uses. DEFAULT app_current_tenant(): references/postgres-rls.md section 2
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  time_zone  text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',   -- IANA name; its CHECK: the vibe-frontend skill (references/i18n.md)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Global: one person can belong to several tenants
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text,                                    -- NULL: signs in with Apple/Google only
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  role       text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE customers (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name  text NOT NULL CHECK (full_name IS NFC NORMALIZED AND length(full_name) BETWEEN 1 AND 200),
  phone      text NOT NULL CHECK (phone ~ '^0[0-9]{9,10}$'),   -- stored as 0912345678
  email      text,
  birthday   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE appointments (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL,
  staff_user_id uuid NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_user_id) REFERENCES memberships (tenant_id, user_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX appointments_customer ON appointments (tenant_id, customer_id);
CREATE INDEX appointments_starts ON appointments (tenant_id, starts_at);
-- No double booking: the exclusion constraint in references/data-layer.md section 6
