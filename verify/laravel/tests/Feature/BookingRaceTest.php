<?php
// tests/Feature/BookingRaceTest.php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Support\TestServer;
use Tests\TestCase;

final class BookingRaceTest extends TestCase
{
    // 10 overlapping slots for one staff member, sent at once to 10 PHP workers: one booking, nine 409
    public function test_ten_concurrent_bookings_one_wins(): void
    {
        $owner = $this->member();
        $customer = $this->customer($owner, 'Khách', '0914000001');
        [$server, $url] = TestServer::start(workers: 10);
        try {
            $responses = Http::pool(fn (Pool $pool) => array_map(fn (int $i) => $pool->withToken($owner['token'])->acceptJson()
                ->post("{$url}/v1/t/{$owner['tenantId']}/appointments", [
                    'customerId' => $customer, 'staffUserId' => $owner['userId'],   // 03:00–04:00, 03:03–04:03, ...
                    'startsAt' => sprintf('2026-11-02T03:%02d:00Z', $i * 3), 'endsAt' => sprintf('2026-11-02T04:%02d:00Z', $i * 3),
                ]), range(0, 9)));
        } finally {
            TestServer::stop($server);
        }

        $statuses = array_count_values(array_map(fn ($r) => $r->status(), $responses));
        ksort($statuses);
        $this->assertSame([201 => 1, 409 => 9], $statuses);
        foreach ($responses as $r) {
            $r->status() === 409 && $this->assertSame('appointment_slot_taken', $r->json('error.code'));
        }
        $this->assertSame(1, $this->inTenant($owner, fn () => Appointment::count()));
    }

    // 10 staff members of a new tenant (no history) book the same hour at once, 20 rounds: all booked
    public function test_ten_staff_booking_the_same_hour_all_succeed(): void
    {
        $owner = $this->member();
        $customer = $this->customer($owner, 'Khách', '0914000002');
        $staff = array_map(fn () => $this->member('staff', $owner['tenantId']), range(1, 10));
        [$server, $url] = TestServer::start(workers: 10);
        $statuses = [];
        try {
            foreach (range(10, 29) as $day) {
                $responses = Http::pool(fn (Pool $pool) => array_map(fn (array $s) => $pool->withToken($owner['token'])->acceptJson()
                    ->post("{$url}/v1/t/{$owner['tenantId']}/appointments", ['customerId' => $customer, 'staffUserId' => $s['userId'],
                        'startsAt' => "2026-11-{$day}T03:00:00Z", 'endsAt' => "2026-11-{$day}T04:00:00Z"]), $staff));
                array_push($statuses, ...array_map(fn ($r) => $r->status(), $responses));
            }
        } finally {
            TestServer::stop($server);
        }
        $this->assertSame([201 => 200], array_count_values($statuses));
    }

    // The optimizer picked PRIMARY (tenant_id) for a small tenant: a scan that locks every staff member's rows
    public function test_the_overlap_check_stays_on_the_staff_index(): void
    {
        $owner = $this->member();
        $customer = $this->customer($owner, 'Khách', '0914000003');
        $this->as($owner)->postJson("/v1/t/{$owner['tenantId']}/appointments", ['customerId' => $customer, 'staffUserId' => $owner['userId'],
            'startsAt' => '2026-11-02T03:00:00Z', 'endsAt' => '2026-11-02T04:00:00Z'])->assertCreated();
        $this->inTenant($owner, function () use ($owner) {
            $query = app(BookingService::class)->overlapping($owner['userId'],
                CarbonImmutable::parse('2026-11-02T03:30:00Z'), CarbonImmutable::parse('2026-11-02T04:30:00Z'));
            $plan = fn () => DB::selectOne('EXPLAIN '.$query->clone()->sharedLock()->toRawSql())->key;
            $this->assertSame('appointments_staff', $plan());
            $query->getQuery()->indexHint = null;
            $this->assertSame('PRIMARY', $plan());   // control: without the hint
        });
    }
}
