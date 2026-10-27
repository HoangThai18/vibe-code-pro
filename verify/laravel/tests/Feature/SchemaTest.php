<?php

namespace Tests\Feature;

use App\Models\Customer;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

// The database itself, below Eloquent: what holds even when code skips the tenant scope
final class SchemaTest extends TestCase
{
    private function mysqlError(callable $fn): QueryException
    {
        try {
            $fn();
        } catch (QueryException $e) {
            return $e;
        }
        $this->fail('expected a database error');
    }

    public function test_composite_fks_reject_another_tenants_customer_and_staff(): void
    {
        [$a, $b, $aCustomer, $bCustomer] = $this->seedTwoTenants();
        $row = fn (string $customer, string $staff) => fn () => DB::table('appointments')->insert([
            'tenant_id' => $a['tenantId'], 'id' => (string) Str::uuid7(), 'customer_id' => $customer, 'staff_user_id' => $staff,
            'starts_at' => '2026-11-02 03:00:00', 'ends_at' => '2026-11-02 04:00:00',
        ]);
        $this->assertSame(1452, $this->mysqlError($row($bCustomer, $a['userId']))->errorInfo[1]);
        $this->assertSame(1452, $this->mysqlError($row($aCustomer, $b['userId']))->errorInfo[1]);
        $row($aCustomer, $a['userId'])();   // control
        $this->assertSame(1, DB::table('appointments')->where('tenant_id', $a['tenantId'])->count());
    }

    public function test_phone_is_unique_per_tenant_and_the_exception_names_the_index(): void
    {
        [$a, , $aCustomer] = $this->seedTwoTenants();
        try {
            DB::table('customers')->insert(['tenant_id' => $a['tenantId'], 'id' => (string) Str::uuid7(), 'full_name' => 'Trùng', 'phone' => '0912345678']);
            $this->fail('duplicate accepted');
        } catch (UniqueConstraintViolationException $e) {
            $this->assertSame('customers_tenant_id_phone_unique', $e->index);
            $this->assertSame(1062, $e->errorInfo[1]);
            $this->assertStringContainsString('Trùng, 0912345678)', $e->getMessage());   // bound values are in the message
        }
    }

    public function test_check_constraints_hold(): void
    {
        [$a, , $aCustomer] = $this->seedTwoTenants();
        $bad = fn (array $row) => fn () => DB::table('customers')->insert([
            'tenant_id' => $a['tenantId'], 'id' => (string) Str::uuid7(), 'full_name' => 'X', 'phone' => '0912000123', ...$row]);
        $this->assertSame(3819, $this->mysqlError($bad(['phone' => '1912000123']))->errorInfo[1]);   // Check constraint violated
        $this->assertSame(3819, $this->mysqlError(fn () => DB::table('appointments')->insert([
            'tenant_id' => $a['tenantId'], 'id' => (string) Str::uuid7(), 'customer_id' => $aCustomer, 'staff_user_id' => $a['userId'],
            'starts_at' => '2026-11-02 04:00:00', 'ends_at' => '2026-11-02 03:00:00']))->errorInfo[1]);
    }

    public function test_the_schema_builder_wrote_the_composite_keys(): void
    {
        $ddl = DB::selectOne('SHOW CREATE TABLE appointments')->{'Create Table'};
        $this->assertStringContainsString('PRIMARY KEY (`tenant_id`,`id`)', $ddl);
        $this->assertStringContainsString('FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers` (`tenant_id`, `id`)', $ddl);
        $this->assertStringContainsString('FOREIGN KEY (`tenant_id`, `staff_user_id`) REFERENCES `memberships` (`tenant_id`, `user_id`)', $ddl);
    }

    // references/mysql.md section 3: ids ascii_bin, both sides of every FK alike (else 3780)
    public function test_every_uuid_column_is_ascii_bin(): void
    {
        $other = DB::select("SELECT table_name, column_name, collation_name FROM information_schema.columns
            WHERE table_schema = DATABASE() AND data_type = 'char' AND character_maximum_length = 36
              AND collation_name <> 'ascii_bin'");
        $this->assertSame([], $other);
        $this->assertSame('utf8mb4_0900_ai_ci', DB::selectOne("SELECT collation_name AS c FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'full_name'")->c);
    }

    // utf8mb4_0900_ai_ci: Đặng = dang, Thảo = thao. The skeleton's utf8mb4_unicode_ci misses 'dang'.
    public function test_name_search_ignores_tones_and_d(): void
    {
        [$a] = $this->seedTwoTenants();
        $this->customer($a, 'Đặng Thị Thảo', '0912000201');
        $names = fn (string $word) => $this->inTenant($a, fn () => Customer::where('full_name', 'like', "%{$word}%")->pluck('full_name')->all());
        $this->assertSame(['Đặng Thị Thảo'], $names('dang'));
        $this->assertSame(['Đặng Thị Thảo'], $names('thao'));
    }

    // 'strict' => false (often set to silence ONLY_FULL_GROUP_BY) sets sql_mode NO_ENGINE_SUBSTITUTION only
    public function test_strict_false_truncates_silently(): void
    {
        [$a] = $this->seedTwoTenants();
        config(['database.connections.loose' => ['strict' => false] + config('database.connections.mysql')]);
        $row = fn (string $conn) => fn () => DB::connection($conn)->table('customers')->insert(['tenant_id' => $a['tenantId'],
            'id' => (string) \Illuminate\Support\Str::uuid7(), 'full_name' => str_repeat('Thảo ', 50), 'phone' => '0912000202']);
        $this->assertSame(1406, $this->mysqlError($row('mysql'))->errorInfo[1]);   // Data too long
        $row('loose')();
        $this->assertSame(200, DB::selectOne("SELECT CHAR_LENGTH(full_name) AS n FROM customers WHERE phone = '0912000202'")->n);
    }

    // references/mysql.md section 5: write the algorithm every time; Laravel 13 has modifiers for it
    public function test_the_schema_builder_writes_algorithm_and_lock(): void
    {
        Schema::dropIfExists('ddl_probe');
        Schema::create('ddl_probe', fn (Blueprint $t) => $t->id());
        $sql = [];
        DB::listen(function ($q) use (&$sql) { $sql[] = $q->sql; });
        Schema::table('ddl_probe', fn (Blueprint $t) => $t->string('note')->nullable()->instant());
        Schema::table('ddl_probe', fn (Blueprint $t) => $t->index('note')->inplace()->lock('none'));
        Schema::drop('ddl_probe');
        $this->assertSame('alter table `ddl_probe` add `note` varchar(255) null, algorithm=instant', $sql[0]);
        $this->assertSame('alter table `ddl_probe` add index `ddl_probe_note_index`(`note`), algorithm=inplace, lock=none', $sql[1]);
    }
}
