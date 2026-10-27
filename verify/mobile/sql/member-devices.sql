-- Push worker inside withTenant: the memberships RLS policy keeps only this spa's members
SELECT d.push_token FROM devices d JOIN memberships m ON m.user_id = d.user_id WHERE m.user_id = $1;
