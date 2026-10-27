<?php

namespace App\Auth;

// The fixed roles of references/auth.md section 4, in one place, deny by default.
// AppServiceProvider defines one Gate ability per action: Gate::authorize('customer.write').
final class Permissions
{
    public const ACTIONS = [
        'customer.read', 'customer.write', 'customer.import',
        'appointment.write', 'appointment.confirm',
        'billing.manage', 'member.invite', 'member.role_change', 'api_key.manage',
    ];

    private const ROLES = [
        'owner' => self::ACTIONS,
        'manager' => ['customer.read', 'customer.write', 'customer.import', 'appointment.write',
            'appointment.confirm', 'member.invite', 'member.role_change'],
        'staff' => ['customer.read', 'appointment.write'],   // own appointments only: AppointmentPolicy
    ];

    public static function can(?string $role, string $action): bool
    {
        return in_array($action, self::ROLES[$role] ?? [], true);   // unknown role → nothing
    }
}
