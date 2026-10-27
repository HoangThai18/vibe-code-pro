<?php

namespace Tests\Feature;

use App\Tenancy\PostgresTenant;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

// Laravel on PostgreSQL with FORCE RLS, connected as app_user (verify.sh sets PG_APP_URL from run.sh's DATABASE_URL)
final class PostgresRlsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        if (! env('PG_APP_URL')) {
            $this->markTestSkipped('no PostgreSQL (PG_URL=none)');
        }
        DB::connection('pgsql')->table('customers')->delete();   // the owner connection is a superuser here
        DB::table('jobs')->delete();
        CountsPgCustomers::$counts = [];
    }

    private function seedTenants(): array
    {
        [$a, $b] = [(string) Str::uuid(), (string) Str::uuid()];
        PostgresTenant::run($a, fn ($db) => $db->table('customers')->insert(['full_name' => 'Khách của A', 'phone' => '0912345678']));
        PostgresTenant::run($b, fn ($db) => $db->table('customers')->insert(['full_name' => 'Khách của B', 'phone' => '0987654321']));

        return [$a, $b];
    }

    public function test_rls_shows_the_current_tenant_only_and_nothing_without_one(): void
    {
        [$a, $b] = $this->seedTenants();
        $this->assertSame(['Khách của A'], PostgresTenant::run($a, fn ($db) => $db->table('customers')->pluck('full_name')->all()));
        $this->assertSame(0, DB::connection('pgsql_app')->table('customers')->count());   // no tenant: no rows, no error
        try {
            PostgresTenant::run($a, fn ($db) => $db->table('customers')->insert(['tenant_id' => $b, 'full_name' => 'Lậu', 'phone' => '0900000000']));
            $this->fail('inserted into another tenant');
        } catch (QueryException $e) {
            $this->assertSame('42501', $e->getCode());   // new row violates row-level security policy
        }
    }

    public function test_a_session_level_tenant_leaks_into_the_next_job_of_the_worker(): void
    {
        [$a] = $this->seedTenants();
        SetsPgTenant::dispatch($a, false);   // set_config(..., false): the whole session
        CountsPgCustomers::dispatch();       // no tenant of its own
        SetsPgTenant::dispatch($a, true);    // PostgresTenant::run: this transaction only
        Artisan::call('queue:work', ['--stop-when-empty' => true, '--sleep' => 0]);
        $this->assertSame([1], CountsPgCustomers::$counts);   // the second job saw tenant A's rows

        DB::connection('pgsql_app')->select("SELECT set_config('app.tenant_id', '', false)");
        SetsPgTenant::dispatch($a, true);
        CountsPgCustomers::dispatch();
        Artisan::call('queue:work', ['--stop-when-empty' => true, '--sleep' => 0]);
        $this->assertSame([1, 0], CountsPgCustomers::$counts);
    }
}

class SetsPgTenant implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $tenantId, public bool $transactionOnly) {}

    public function handle(): void
    {
        $this->transactionOnly
            ? PostgresTenant::run($this->tenantId, fn ($db) => $db->table('customers')->count())
            : DB::connection('pgsql_app')->select("SELECT set_config('app.tenant_id', ?, false)", [$this->tenantId]);
    }
}

class CountsPgCustomers implements ShouldQueue
{
    use Queueable;

    public static array $counts = [];

    public function handle(): void
    {
        self::$counts[] = DB::connection('pgsql_app')->table('customers')->count();
    }
}
