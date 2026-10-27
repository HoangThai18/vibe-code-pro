-- Read the current tenant. NULLIF: after a transaction with set_config(..., true) ends,
-- that connection returns '' instead of NULL, and ''::uuid raises an error.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
