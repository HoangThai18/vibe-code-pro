-- Ids of active tenants, nothing else. Run as a superuser: the new owner has BYPASSRLS.
CREATE FUNCTION app_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.tenants WHERE status = 'active' ORDER BY id
$$;
GRANT SELECT (id, status) ON tenants TO app_definer;
ALTER FUNCTION app_tenant_ids() OWNER TO app_definer;
REVOKE ALL ON FUNCTION app_tenant_ids() FROM PUBLIC;      -- every role may run a new function by default
GRANT EXECUTE ON FUNCTION app_tenant_ids() TO app_user;   -- or only the worker's role, if it has its own
