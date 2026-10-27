<?php

namespace Tests\Feature;

use App\Models\Membership;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): array
    {
        $tenant = Tenant::create(['name' => 'Spa Hoa Mai']);
        $user = User::create(['email' => 'chu@hoamai.vn', 'password' => 'secret123']);
        Membership::create(['tenant_id' => $tenant->id, 'user_id' => $user->id, 'role' => 'owner']);
        Sanctum::actingAs($user);

        return [$tenant, $user];
    }

    public function test_owner_creates_and_reads_a_customer(): void
    {
        [$tenant] = $this->owner();
        $id = $this->postJson("/v1/t/{$tenant->id}/customers", ['full_name' => 'Nguyễn Thị Thảo', 'phone' => '0912 345 678'])
            ->assertCreated()->json('data.id');
        $this->getJson("/v1/t/{$tenant->id}/customers/{$id}")->assertOk()->assertJsonPath('data.phone', '0912345678');
    }

    public function test_duplicate_phone_is_rejected(): void
    {
        [$tenant] = $this->owner();
        $this->postJson("/v1/t/{$tenant->id}/customers", ['full_name' => 'A', 'phone' => '0912345678'])->assertCreated();
        $this->postJson("/v1/t/{$tenant->id}/customers", ['full_name' => 'B', 'phone' => '0912345678'])->assertStatus(422);
    }
}
