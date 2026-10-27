-- AS RESTRICTIVE: ANDed with tenant_isolation. No scope set → no rows (fail closed).
-- Without WITH CHECK, USING also checks inserted and updated rows.
CREATE POLICY data_scope ON customers AS RESTRICTIVE
  USING (CASE (SELECT app_data_scope())
           WHEN 'tenant' THEN true
           WHEN 'branch' THEN branch_id = ANY ((SELECT app_branch_ids())::uuid[])
           WHEN 'own' THEN branch_id = ANY ((SELECT app_branch_ids())::uuid[])   -- own-scoped staff still find their branch's customers
           ELSE false END);
CREATE POLICY data_scope ON appointments AS RESTRICTIVE
  USING (CASE (SELECT app_data_scope())
           WHEN 'tenant' THEN true
           WHEN 'branch' THEN branch_id = ANY ((SELECT app_branch_ids())::uuid[])
           WHEN 'own' THEN staff_user_id = (SELECT app_actor_id())
           ELSE false END);
