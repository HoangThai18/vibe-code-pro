<?php

namespace Tests;

use App\Models\Customer;
use App\Models\Membership;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Str;

// No RefreshDatabase: its per-test transaction hides commits from other connections (the race test's server,
// the queue worker's locks). Every test seeds its own tenants, so tests don't see each other's rows.
abstract class TestCase extends BaseTestCase
{
    // A tenant with one member: ['tenantId', 'userId', 'token']
    protected function member(string $role = 'owner', ?string $tenantId = null): array
    {
        $tenantId ??= Tenant::create(['name' => 'Spa '.Str::random(6)])->id;
        $user = User::create(['email' => Str::lower(Str::random(12)).'@example.vn', 'password' => 'mat-khau-dai-du']);
        app(TenantContext::class)->run($tenantId, fn () => Membership::create(['user_id' => $user->id, 'role' => $role]));

        return ['tenantId' => $tenantId, 'userId' => $user->id, 'token' => $user->createToken('test')->plainTextToken];
    }

    // Requests as that member. The test app keeps the guard's user between requests: forget it first.
    protected function as(array $member): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($member['token']);
    }

    protected function customer(array $member, string $fullName, string $phone): string
    {
        return $this->as($member)->postJson("/v1/t/{$member['tenantId']}/customers", compact('fullName', 'phone'))
            ->assertCreated()->json('data.id');
    }

    protected function inTenant(array $member, \Closure $fn): mixed
    {
        return app(TenantContext::class)->run($member['tenantId'], $fn);
    }

    // Two tenants, each with a customer, seeded through the API (references/isolation-tests.md section 1)
    protected function seedTwoTenants(): array
    {
        $a = $this->member();
        $b = $this->member();

        return [$a, $b, $this->customer($a, 'Khách của A', '0912345678'), $this->customer($b, 'Khách của B', '0987654321')];
    }

    protected function countCustomers(array $member): int
    {
        return $this->inTenant($member, fn () => Customer::count());
    }
}
