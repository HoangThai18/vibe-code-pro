<?php

namespace App\Policies;

use App\Auth\Permissions;
use App\Models\User;
use App\Tenancy\TenantContext;

// Found by convention for App\Models\Appointment. The role is the membership's in the path tenant.
final class AppointmentPolicy
{
    public function __construct(private TenantContext $tenant) {}

    // Per-record rule (references/auth.md section 5): staff book only for themselves
    public function create(User $user, string $staffUserId): bool
    {
        $role = $this->tenant->role();

        return Permissions::can($role, 'appointment.write') && ($role !== 'staff' || $staffUserId === $user->id);
    }
}
