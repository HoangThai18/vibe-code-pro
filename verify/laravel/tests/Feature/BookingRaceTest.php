<?php
// tests/Feature/BookingRaceTest.php

namespace Tests\Feature;

use App\Models\Appointment;
use Illuminate\Http\Client\Pool;
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
}
