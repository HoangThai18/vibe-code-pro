-- Keyset pagination of the customer list: ORDER BY created_at DESC, id DESC within a tenant
CREATE INDEX customers_created ON customers (tenant_id, created_at, id);
