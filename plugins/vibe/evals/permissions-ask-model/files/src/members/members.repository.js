// memberships(tenant_id, user_id, role): role is free text today ('owner' for the spa's creator)
export async function findMembership(db, userId) {
  const { rows } = await db.query('SELECT role FROM memberships WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}
