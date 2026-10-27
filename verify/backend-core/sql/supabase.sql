CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.user_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()
$$;

CREATE POLICY members_only ON public.customers FOR ALL TO authenticated
  USING (tenant_id IN (SELECT private.user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT private.user_tenant_ids()));
