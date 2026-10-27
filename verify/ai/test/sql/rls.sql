-- Test setup only (not in the docs): FORCE RLS on every tenant table, as in the vibe-backend skill
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = (SELECT app_current_tenant())) WITH CHECK (id = (SELECT app_current_tenant()));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memberships', 'customers', 'customer_notes', 'ai_usage', 'ai_conversations', 'ai_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = (SELECT app_current_tenant()))
                    WITH CHECK (tenant_id = (SELECT app_current_tenant()))', t);
  END LOOP;
END $$;
