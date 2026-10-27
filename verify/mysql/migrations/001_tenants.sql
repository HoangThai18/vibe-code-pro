-- The example schema (references/multi-tenant.md) on MySQL: tenants, users, memberships.
-- The database was created CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; ids and codes are ascii_bin.
CREATE TABLE tenants (
  id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  time_zone  VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
);

CREATE TABLE users (
  id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  email         VARCHAR(254) NOT NULL UNIQUE CHECK (email = LOWER(email)),
  password_hash VARCHAR(255),
  created_at    DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
);

CREATE TABLE memberships (
  tenant_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (tenant_id, user_id),
  KEY memberships_user (user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);
