<?php
// app/Services/BookingService.php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Customer;
use App\Models\Membership;
use App\Support\ApiError;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class BookingService
{
    public function book(string $customerId, string $staffUserId, DateTimeInterface $startsAt, DateTimeInterface $endsAt): Appointment
    {
        Gate::authorize('create', [Appointment::class, $staffUserId]);   // AppointmentPolicy

        return DB::transaction(function () use ($customerId, $staffUserId, $startsAt, $endsAt) {
            if (! Customer::query()->whereKey($customerId)->exists()) {   // tenant scope: another tenant's id isn't found
                throw new ApiError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
            // MySQL has no exclusion constraint: serialize bookings per staff member on their membership row
            $staff = Membership::query()->where('user_id', $staffUserId)->lockForUpdate()->first();
            if ($staff === null) {
                throw new ApiError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
            // A locking read too: under REPEATABLE READ a plain SELECT reads the snapshot taken by the first read
            // above, before we waited for the lock, and misses the booking committed meanwhile
            $taken = Appointment::query()
                ->where('staff_user_id', $staffUserId)
                ->where('status', '<>', 'cancelled')
                ->where('starts_at', '<', $endsAt)->where('ends_at', '>', $startsAt)   // [starts_at, ends_at)
                ->lockForUpdate()->exists();
            if ($taken) {
                throw new ApiError(409, 'appointment_slot_taken', 'Khung giờ này đã có lịch.');
            }

            return Appointment::create([
                'customer_id' => $customerId, 'staff_user_id' => $staffUserId,
                'starts_at' => $startsAt, 'ends_at' => $endsAt,
            ]);
        });
    }
}
