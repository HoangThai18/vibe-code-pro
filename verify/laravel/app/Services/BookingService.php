<?php
// app/Services/BookingService.php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Customer;
use App\Models\Membership;
use App\Support\ApiError;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class BookingService
{
    public const MAX_HOURS = 12;   // = the CHECK on appointments; bounds the overlap scan

    public function book(string $customerId, string $staffUserId, CarbonImmutable $startsAt, CarbonImmutable $endsAt): Appointment
    {
        Gate::authorize('create', [Appointment::class, $staffUserId]);   // AppointmentPolicy

        // Next transaction only (refused inside one: 1568). No gap locks, and each SELECT sees the latest commits.
        DB::statement('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

        return DB::transaction(function () use ($customerId, $staffUserId, $startsAt, $endsAt) {
            if (! Customer::query()->whereKey($customerId)->exists()) {   // tenant scope: another tenant's id isn't found
                throw new ApiError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
            // No exclusion constraint on MySQL: one booking at a time per staff member, on their membership row
            if (Membership::query()->where('user_id', $staffUserId)->lockForUpdate()->first() === null) {
                throw new ApiError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
            if ($this->overlapping($staffUserId, $startsAt, $endsAt)->exists()) {
                throw new ApiError(409, 'appointment_slot_taken', 'Khung giờ này đã có lịch.');
            }

            return Appointment::create([
                'customer_id' => $customerId, 'staff_user_id' => $staffUserId,
                'starts_at' => $startsAt, 'ends_at' => $endsAt,
            ]);
        });
    }

    public function overlapping(string $staffUserId, CarbonImmutable $startsAt, CarbonImmutable $endsAt): Builder
    {
        return Appointment::query()->forceIndex('appointments_staff')   // the optimizer chose PRIMARY for a small tenant
            ->where('staff_user_id', $staffUserId)
            ->where('status', '<>', 'cancelled')
            ->where('starts_at', '>', $startsAt->subHours(self::MAX_HOURS))
            ->where('starts_at', '<', $endsAt)
            ->where('ends_at', '>', $startsAt);   // [starts_at, ends_at)
    }
}
