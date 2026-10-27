-- Ids of active tenants, nothing else (postgres-rls.md section 3). Flyway runs as the table owner, a member of the
-- definer role, so it can hand the function over; the owner can already switch RLS off, so this adds no power.
CREATE FUNCTION app_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.tenants WHERE status = 'active' ORDER BY id
$$;
REVOKE ALL ON FUNCTION app_tenant_ids() FROM PUBLIC;           -- every role may run a new function by default
GRANT EXECUTE ON FUNCTION app_tenant_ids() TO ${app_role};
GRANT SELECT (id, status) ON tenants TO ${definer_role};
ALTER FUNCTION app_tenant_ids() OWNER TO ${definer_role};      -- BYPASSRLS, NOLOGIN
