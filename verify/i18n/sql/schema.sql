-- Tenant settings; move time_zone/currency to branches when one opens abroad
CREATE TABLE tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  default_locale text NOT NULL DEFAULT 'vi' CHECK (default_locale IN ('vi', 'en')),
  -- IANA Area/City only: Postgres also accepts 'GMT+7', '+07' and 'Etc/GMT+7', and reads all three as UTC-7 (POSIX sign)
  time_zone      text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'
                 CHECK (time_zone ~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z0-9_/+-]+$'
                        AND now() AT TIME ZONE time_zone IS NOT NULL),
  currency       char(3) NOT NULL DEFAULT 'VND'
);
ALTER TABLE users ADD COLUMN locale text CHECK (locale IN ('vi', 'en'));  -- NULL: follow the tenant

CREATE TABLE customers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  full_name text NOT NULL CHECK (full_name IS NFC NORMALIZED),  -- one field, as typed
  birthday  date,                                               -- a calendar date, not a timestamp
  locale    text CHECK (locale IN ('vi', 'en'))                 -- language of SMS/email to this customer
);
CREATE INDEX customers_name_vi ON customers (tenant_id, full_name COLLATE "vi-x-icu");
