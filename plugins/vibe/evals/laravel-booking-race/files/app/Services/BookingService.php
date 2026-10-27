<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Customer;
use App\Models\Membership;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BookingService
{
    public function book(string $customerId, string $staffUserId, CarbonImmutable $startsAt, CarbonImmutable $endsAt): Appointment
    {
        return DB::transaction(function () use ($customerId, $staffUserId, $startsAt, $endsAt) {
            Customer::findOrFail($customerId);
            Membership::findOrFail($staffUserId);

            $overlap = Appointment::query()
                ->where('staff_user_id', $staffUserId)
                ->where('status', '<>', 'cancelled')
                ->where('starts_at', '<', $endsAt)
                ->where('ends_at', '>', $startsAt)
                ->exists();
            if ($overlap) {
                throw new HttpException(409, 'appointment_slot_taken');
            }

            return Appointment::create([
                'customer_id' => $customerId,
                'staff_user_id' => $staffUserId,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
            ]);
        });
    }
}
