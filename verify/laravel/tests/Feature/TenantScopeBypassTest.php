<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Tenancy\MissingTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Tests\TestCase;

// Each way around BelongsToTenant, shown working. What the scope does not cover, code review and tests must.
final class TenantScopeBypassTest extends TestCase
{
    public function test_the_query_builder_and_raw_sql_ignore_the_scope(): void
    {
        [$a, $b, , $bCustomer] = $this->seedTwoTenants();
        $this->inTenant($a, function () use ($bCustomer) {
            $this->assertFalse(Customer::whereKey($bCustomer)->exists());
            $this->assertTrue(DB::table('customers')->where('id', $bCustomer)->exists());              // leaks
            $this->assertCount(1, DB::select('SELECT id FROM customers WHERE id = ?', [$bCustomer]));    // leaks
            $this->assertTrue(Customer::withoutGlobalScope('tenant')->whereKey($bCustomer)->exists());   // leaks
            // Without Eloquent, filter by hand
            $this->assertFalse(DB::table('customers')->where('tenant_id', app(TenantContext::class)->id())
                ->where('id', $bCustomer)->exists());
        });
    }

    public function test_no_context_fails_closed(): void
    {
        app(TenantContext::class)->clear();
        $this->expectException(MissingTenantContext::class);
        Customer::count();                          // a command or job that forgot TenantContext::run()
    }

    public function test_unique_and_exists_rules_query_every_tenant(): void
    {
        [$a, $b, $aCustomer, $bCustomer] = $this->seedTwoTenants();   // A has 0912345678
        $this->inTenant($b, function () use ($b, $bCustomer, $aCustomer) {
            $phone = ['phone' => '0912345678'];
            // B is told A's phone is "taken": a 422 that leaks another tenant's data, and B can't add the customer
            $this->assertTrue(Validator::make($phone, ['phone' => 'unique:customers,phone'])->fails());
            $this->assertTrue(Validator::make($phone, ['phone' => Rule::unique(Customer::class, 'phone')])->fails());   // a model class doesn't help
            $this->assertFalse(Validator::make($phone, ['phone' => Rule::unique('customers', 'phone')->where('tenant_id', $b['tenantId'])])->fails());

            // exists: accepts A's customer id inside tenant B
            $this->assertTrue(Validator::make(['customerId' => $aCustomer], ['customerId' => 'exists:customers,id'])->passes());
            $scoped = ['customerId' => Rule::exists('customers', 'id')->where('tenant_id', $b['tenantId'])];
            $this->assertTrue(Validator::make(['customerId' => $aCustomer], $scoped)->fails());
            $this->assertTrue(Validator::make(['customerId' => $bCustomer], $scoped)->passes());   // control
        });
    }

    public function test_route_model_binding_of_a_model_without_the_trait_returns_another_tenants_row(): void
    {
        [$a, , , $bCustomer] = $this->seedTwoTenants();
        Route::middleware(['api', 'auth:sanctum', 'tenant'])
            ->get('/v1/t/{tenant}/legacy/{legacyCustomer}', fn (LegacyCustomer $legacyCustomer) => ['name' => $legacyCustomer->full_name]);
        $this->as($a)->getJson("/v1/t/{$a['tenantId']}/legacy/{$bCustomer}")->assertOk()->assertJsonPath('name', 'Khách của B');
        $this->as($a)->getJson("/v1/t/{$a['tenantId']}/customers/{$bCustomer}")->assertNotFound();   // Customer uses BelongsToTenant
    }

    public function test_cache_keys_and_storage_paths_carry_the_tenant(): void
    {
        [$a, $b] = $this->seedTwoTenants();
        $this->customer($a, 'Khách 2 của A', '0912000099');
        $count = fn () => Cache::remember('customer_count', 60, fn () => Customer::count());
        $scoped = fn () => Cache::remember(app(TenantContext::class)->cacheKey('customer_count'), 60, fn () => Customer::count());

        $this->assertSame(2, $this->inTenant($a, $count));
        $this->assertSame(2, $this->inTenant($b, $count));    // B gets A's cached number
        $this->assertSame(2, $this->inTenant($a, $scoped));
        $this->assertSame(1, $this->inTenant($b, $scoped));
        $this->assertSame("tenants/{$b['tenantId']}/exports/khach.csv", $this->inTenant($b, fn () => app(TenantContext::class)->storagePath('exports/khach.csv')));
    }
}

// A model someone added without BelongsToTenant
class LegacyCustomer extends Model
{
    protected $table = 'customers';
}
