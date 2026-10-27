<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Tenancy\MissingTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

// A queue worker is one long-lived process: no request, and whatever the previous job left behind
final class QueueTenantContextTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::table('jobs')->delete();
        DB::table('failed_jobs')->delete();
        CountsCustomers::$counts = [];
    }

    public function test_the_dispatching_requests_tenant_does_not_travel_with_the_job(): void
    {
        [$a] = $this->seedTwoTenants();
        $this->inTenant($a, fn () => CountsCustomers::dispatch());   // dispatched "inside" tenant A
        Artisan::call('queue:work', ['--stop-when-empty' => true, '--sleep' => 0]);
        $this->assertSame([], CountsCustomers::$counts);
        $this->assertStringContainsString(MissingTenantContext::class, DB::table('failed_jobs')->value('exception'));
    }

    public function test_a_job_that_leaves_its_tenant_set_does_not_leak_into_the_next_job(): void
    {
        [$a] = $this->seedTwoTenants();
        LeavesTenantSet::dispatch($a['tenantId']);
        CountsCustomers::dispatch();
        Artisan::call('queue:work', ['--stop-when-empty' => true, '--sleep' => 0]);
        // TenantContext is scoped: the worker resets it before each job. As a singleton the second job counts A's customers.
        $this->assertSame([], CountsCustomers::$counts);
        $this->assertSame(1, DB::table('failed_jobs')->count());
    }
}

// Forgot the tenant: no tenantId property, no TenantContext::run()
class CountsCustomers implements ShouldQueue
{
    use Queueable;

    public static array $counts = [];

    public int $tries = 1;

    public function handle(): void
    {
        self::$counts[] = Customer::count();
    }
}

// Sets the context and never restores it (use TenantContext::run instead)
class LeavesTenantSet implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $tenantId) {}

    public function handle(TenantContext $tenant): void
    {
        $tenant->set($this->tenantId);
    }
}
