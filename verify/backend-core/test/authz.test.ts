import { describe, it, expect } from 'vitest';
import { can, authorize, ForbiddenError, type Role, type Action } from '../src/shared/authz';

describe('permission matrix', () => {
  it.each<[Role, Action, boolean]>([
    ['owner', 'billing.manage', true],
    ['owner', 'api_key.manage', true],
    ['manager', 'appointment.confirm', true],
    ['manager', 'customer.import', true],
    ['manager', 'member.role_change', true],
    ['manager', 'billing.manage', false],
    ['manager', 'api_key.manage', false],
    ['staff', 'customer.read', true],
    ['staff', 'customer.write', false],
    ['staff', 'customer.import', false],
    ['staff', 'appointment.write', true],
    ['staff', 'appointment.confirm', false],
    ['staff', 'member.role_change', false],
  ])('%s %s → %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('a role missing from the table is denied', () => {
    expect(() => authorize({ type: 'user', id: 'u1', role: 'intern' as Role }, 'customer.read')).toThrow(ForbiddenError);
  });

  it('an API key gets exactly its scopes', () => {
    const key = { type: 'api_key', id: 'k1', scopes: ['customer.read'] } as const;
    expect(() => authorize(key, 'customer.read')).not.toThrow();
    expect(() => authorize(key, 'customer.write')).toThrow(ForbiddenError);
  });
});
