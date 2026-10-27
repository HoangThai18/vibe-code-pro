// shared/authz.ts
import { HttpError } from './errors';

export type Role = 'owner' | 'manager' | 'staff';
export const ACTIONS = [
  'customer.read', 'customer.write', 'customer.import',
  'appointment.write', 'appointment.confirm',
  'billing.manage', 'member.invite', 'member.role_change', 'api_key.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

export type UserActor = { type: 'user'; id: string; role: Role };
export type ApiKeyActor = { type: 'api_key'; id: string; scopes: readonly Action[] };
export type Actor = UserActor | ApiKeyActor;

const permissions: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>(ACTIONS),
  manager: new Set<Action>(['customer.read', 'customer.write', 'customer.import', 'appointment.write',
    'appointment.confirm', 'member.invite', 'member.role_change']),
  staff: new Set<Action>(['customer.read', 'appointment.write']),   // own appointments only: checked in section 5
};

// Who may manage whom (member.role_change, section 5)
export const ROLE_RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

export class ForbiddenError extends HttpError {
  constructor(readonly action: Action) { super(403, 'forbidden', `forbidden: ${action}`); }
}

export const isAction = (s: string): s is Action => (ACTIONS as readonly string[]).includes(s);

export function can(role: Role, action: Action): boolean {
  return permissions[role]?.has(action) ?? false;   // unknown role → no permissions
}

// Call at the start of each use case; the HTTP layer maps ForbiddenError → 403. API keys get exactly their scopes.
export function authorize(actor: Actor, action: Action): void {
  const allowed = actor.type === 'api_key' ? actor.scopes.includes(action) : can(actor.role, action);
  if (!allowed) throw new ForbiddenError(action);
}
