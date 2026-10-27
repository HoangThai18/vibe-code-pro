CREATE TABLE tenants (
  id   CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  tenant_id  CHAR(36) NOT NULL,
  id         CHAR(36) NOT NULL,
  full_name  VARCHAR(200) NOT NULL,
  phone      VARCHAR(11) NOT NULL,             -- stored as 0912345678
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY customers_phone (tenant_id, phone),
  KEY customers_name (tenant_id, full_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
