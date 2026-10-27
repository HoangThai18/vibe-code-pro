-- RLS for the import tables (test fixture split; in the app it is the same migration as import.sql)
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_batches
  USING (tenant_id = (SELECT app_current_tenant())) WITH CHECK (tenant_id = (SELECT app_current_tenant()));
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_rows
  USING (tenant_id = (SELECT app_current_tenant())) WITH CHECK (tenant_id = (SELECT app_current_tenant()));
