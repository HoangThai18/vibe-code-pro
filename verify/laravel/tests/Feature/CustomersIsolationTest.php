<?php
// tests/Feature/CustomersIsolationTest.php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class CustomersIsolationTest extends TestCase
{
    // One row per route with a {customer}; the next test fails when a route is missing
    public static function crossTenantRoutes(): array
    {
        return [
            'GET customers/{customer}' => ['GET', []],
            'PATCH customers/{customer}' => ['PATCH', ['fullName' => 'hack']],
        ];
    }

    #[DataProvider('crossTenantRoutes')]
    public function test_tenant_a_cannot_touch_tenant_b_data(string $method, array $body): void
    {
        [$a, $b, , $bCustomer] = $this->seedTwoTenants();
        $call = fn (array $as, string $tenantId) => $this->as($as)->json($method, "/v1/t/{$tenantId}/customers/{$bCustomer}", $body);

        // 1. B's id in A's path: route model binding runs inside A's tenant scope
        $call($a, $a['tenantId'])->assertNotFound()->assertJsonPath('error.code', 'not_found');
        // 2. B's path: A is not a member of B
        $call($a, $b['tenantId'])->assertNotFound();
        // 404 is not enough: B's data is unchanged
        $this->as($b)->getJson("/v1/t/{$b['tenantId']}/customers/{$bCustomer}")->assertJsonPath('data.fullName', 'Khách của B');
        // Control: B's own request succeeds (a wrong route would also answer 404)
        $this->assertLessThan(300, $call($b, $b['tenantId'])->status());
    }

    public function test_every_customer_route_is_listed(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($r) => str_contains($r->uri(), '{customer}'))
            ->flatMap(fn ($r) => array_map(fn ($m) => "$m ".str_replace('v1/t/{tenant}/', '', $r->uri()), array_diff($r->methods(), ['HEAD'])))
            ->sort()->values()->all();
        $this->assertSame($routes, collect(self::crossTenantRoutes())->keys()->sort()->values()->all());
    }
}
