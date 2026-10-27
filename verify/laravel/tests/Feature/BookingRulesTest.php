<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class BookingRulesTest extends TestCase
{
    public function test_overlap_touching_slots_other_staff_cancelled_and_length(): void
    {
        $owner = $this->member();
        $other = $this->member('staff', $owner['tenantId']);
        $customer = $this->customer($owner, 'Khách', '0914000010');
        $book = fn (string $staff, string $from, string $to) => $this->as($owner)->postJson("/v1/t/{$owner['tenantId']}/appointments",
            ['customerId' => $customer, 'staffUserId' => $staff, 'startsAt' => "2026-11-02T{$from}:00Z", 'endsAt' => "2026-11-02T{$to}:00Z"]);

        $first = $book($owner['userId'], '03:00', '04:00')->assertCreated()->json('data.id');
        $book($owner['userId'], '03:30', '04:30')->assertStatus(409)->assertJsonPath('error.code', 'appointment_slot_taken');
        $book($owner['userId'], '04:00', '05:00')->assertCreated();   // [starts_at, ends_at): touching is free
        $book($other['userId'], '03:00', '04:00')->assertCreated();   // another staff member
        $this->inTenant($owner, fn () => Appointment::whereKey($first)->update(['status' => 'cancelled']));
        $book($owner['userId'], '03:00', '04:00')->assertCreated();   // cancelled ones don't count
        $book($owner['userId'], '05:00', '17:01')->assertStatus(400);  // over 12 hours (the CHECK bounds the scan)
    }

    // SET TRANSACTION ISOLATION LEVEL applies to the next transaction and is refused inside one (RefreshDatabase too)
    public function test_booking_inside_an_open_transaction_is_refused(): void
    {
        $owner = $this->member();
        $customer = $this->customer($owner, 'Khách', '0914000011');
        $this->actingAs(\App\Models\User::findOrFail($owner['userId']));
        $this->inTenant($owner, function () use ($owner, $customer) {
            app(\App\Tenancy\TenantContext::class)->set($owner['tenantId'], 'owner');
            try {
                DB::transaction(fn () => app(BookingService::class)->book($customer, $owner['userId'],
                    CarbonImmutable::parse('2026-11-03T03:00:00Z'), CarbonImmutable::parse('2026-11-03T04:00:00Z')));
                $this->fail('booked inside a transaction');
            } catch (QueryException $e) {
                $this->assertSame(1568, $e->errorInfo[1]);   // Transaction characteristics can't be changed while a transaction is in progress
            }
        });
    }
}
