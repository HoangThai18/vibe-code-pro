CREATE TABLE tenants (
  id   CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL
);

CREATE TABLE memberships (
  tenant_id CHAR(36) CHARACTER SET ascii NOT NULL,
  user_id   CHAR(36) CHARACTER SET ascii NOT NULL,
  role      VARCHAR(20) NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE customers (
  tenant_id CHAR(36) CHARACTER SET ascii NOT NULL,
  id        CHAR(36) CHARACTER SET ascii NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  phone     VARCHAR(11) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY customers_phone (tenant_id, phone),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE appointments (
  tenant_id     CHAR(36) CHARACTER SET ascii NOT NULL,
  id            CHAR(36) CHARACTER SET ascii NOT NULL,
  customer_id   CHAR(36) CHARACTER SET ascii NOT NULL,
  staff_user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  starts_at     DATETIME(3) NOT NULL,
  ends_at       DATETIME(3) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'booked',
  PRIMARY KEY (tenant_id, id),
  KEY appointments_customer (tenant_id, customer_id),
  KEY appointments_starts (tenant_id, starts_at),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_user_id) REFERENCES memberships (tenant_id, user_id)
);
