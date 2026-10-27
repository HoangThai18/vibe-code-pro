<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Membership;
use App\Models\Tenant;
use App\Models\User;
use App\Support\CurrentTenant;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BookingTest extends TestCase
{
    public function test_overlapping_booking_is_rejected(): void
    {
        $tenant = Tenant::create(['name' => 'Spa Hoa Mai']);
        $owner = User::create(['email' => 'chu'.uniqid().'@hoamai.vn', 'password' => 'secret123']);
        app(CurrentTenant::class)->set($tenant->id);
        Membership::create(['user_id' => $owner->id, 'role' => 'owner']);
        $customer = Customer::create(['full_name' => 'Nguyễn Thị Thảo', 'phone' => '0912345678']);
        Sanctum::actingAs($owner);

        $url = "/v1/t/{$tenant->id}/appointments";
        $slot = ['customer_id' => $customer->id, 'staff_user_id' => $owner->id];
        $this->postJson($url, $slot + ['starts_at' => '2026-11-02T03:00:00Z', 'ends_at' => '2026-11-02T04:00:00Z'])->assertCreated();
        $this->postJson($url, $slot + ['starts_at' => '2026-11-02T03:30:00Z', 'ends_at' => '2026-11-02T04:30:00Z'])->assertStatus(409);
    }
}
