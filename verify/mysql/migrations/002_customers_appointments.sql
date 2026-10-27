-- customers and appointments: tenant-first keys, composite FKs, uniques with tenant_id, UTC DATETIME(3)
CREATE TABLE customers (
  tenant_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  full_name  VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(TRIM(full_name)) >= 1),   -- NFC: normalized by the app
  phone      VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (phone REGEXP '^0[0-9]{9,10}$'),
  email      VARCHAR(254),
  birthday   DATE,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY customers_phone (tenant_id, phone),
  KEY customers_name (tenant_id, full_name),
  KEY customers_created (tenant_id, created_at, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE appointments (
  tenant_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  customer_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  staff_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_at     DATETIME(3) NOT NULL,   -- UTC
  ends_at       DATETIME(3) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show')),
  created_at    DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (tenant_id, id),
  KEY appointments_customer (tenant_id, customer_id),
  KEY appointments_starts (tenant_id, starts_at),
  KEY appointments_staff (tenant_id, staff_user_id, starts_at),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_user_id) REFERENCES memberships (tenant_id, user_id),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + INTERVAL 12 HOUR)   -- bounds the overlap scan
);
