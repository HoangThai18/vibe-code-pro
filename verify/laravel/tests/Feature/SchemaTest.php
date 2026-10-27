<?php

namespace Tests\Feature;

use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
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
}
