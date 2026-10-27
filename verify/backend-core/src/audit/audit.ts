// src/audit/audit.ts — call in the same transaction as the change it records
import type { PoolClient } from 'pg';
import type { Actor } from '../shared/authz';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  diff?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function audit(db: PoolClient, actor: Actor, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, diff, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actor.type, actor.id, e.action, e.entity, e.entityId ?? null, e.diff ?? {}, e.ip ?? null, e.userAgent ?? null],
  );
}
