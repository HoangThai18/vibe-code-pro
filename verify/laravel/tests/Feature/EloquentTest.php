<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Customer;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Database\LazyLoadingViolationException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class EloquentTest extends TestCase
{
    private function book(array $m, string $customer, int $count): void
    {
        foreach (range(1, $count) as $i) {
            $this->as($m)->postJson("/v1/t/{$m['tenantId']}/appointments", ['customerId' => $customer, 'staffUserId' => $m['userId'],
                'startsAt' => sprintf('2026-11-%02dT03:00:00Z', $i), 'endsAt' => sprintf('2026-11-%02dT04:00:00Z', $i)])->assertCreated();
        }
    }

    private function queriesOf(callable $fn): int
    {
        $n = 0;
        DB::listen(function () use (&$n) { $n++; });
        $fn();

        return $n;
    }

    public function test_lazy_loading_throws_outside_production(): void
    {
        $m = $this->member();
        $this->book($m, $this->customer($m, 'Thảo', '0913000001'), 2);
        $this->inTenant($m, fn () => Appointment::query()->limit(1)->get()->first()->customer);   // one row: allowed
        $this->expectException(LazyLoadingViolationException::class);
        $this->inTenant($m, fn () => Appointment::query()->get()->first()->customer);             // 2+ rows: throws
    }

    public function test_the_list_runs_the_same_queries_for_2_and_20_rows(): void
    {
        $m = $this->member();
        $two = $this->member();
        $this->book($m, $this->customer($m, 'Thảo', '0913000002'), 20);
        $this->book($two, $this->customer($two, 'Lan', '0913000003'), 2);
        $list = fn (array $as) => fn () => $this->as($as)->getJson("/v1/t/{$as['tenantId']}/appointments?from=2026-11-01&to=2026-12-01")
            ->assertOk()->assertJsonPath('data.0.customer.fullName', $as === $m ? 'Thảo' : 'Lan');
        $this->assertSame($this->queriesOf($list($two)), $this->queriesOf($list($m)));
    }

    public function test_save_filters_by_tenant_so_mysql_uses_the_primary_key(): void
    {
        $m = $this->member();
        $id = $this->customer($m, 'Thảo', '0913000004');
        $sql = [];
        DB::listen(function ($q) use (&$sql) { $sql[] = $q->sql; });
        $this->inTenant($m, fn () => Customer::findOrFail($id)->update(['full_name' => 'Thảo Nguyễn']));
        $update = collect($sql)->first(fn ($s) => str_starts_with($s, 'update'));
        $this->assertSame('update `customers` set `full_name` = ? where `id` = ? and `tenant_id` = ?', $update);

        $explain = fn (string $where, array $bindings) => DB::selectOne("EXPLAIN UPDATE customers SET full_name = 'x' WHERE $where", $bindings);
        $this->assertSame('PRIMARY', $explain('id = ? AND tenant_id = ?', [$id, $m['tenantId']])->key);
        // id alone (Eloquent's default): a scan of the whole primary key, and InnoDB locks every row it scans
        $this->assertSame('index', $explain('id = ?', [$id])->type);
    }

    public function test_an_update_by_id_alone_locks_other_tenants_rows(): void
    {
        [$a, $b, $aCustomer, $bCustomer] = $this->seedTwoTenants();
        config(['database.connections.second' => config('database.connections.mysql')]);
        $second = DB::connection('second');
        $second->statement('SET SESSION innodb_lock_wait_timeout = 1');
        $blocked = function (string $where, array $bindings) use ($second, $bCustomer, $b): bool {
            DB::beginTransaction();
            DB::update("UPDATE customers SET full_name = full_name WHERE $where", $bindings);
            try {
                $second->update('UPDATE customers SET full_name = ? WHERE tenant_id = ? AND id = ?', ['B', $b['tenantId'], $bCustomer]);

                return false;
            } catch (\Illuminate\Database\QueryException $e) {
                return $e->errorInfo[1] === 1205;   // Lock wait timeout exceeded
            } finally {
                DB::rollBack();
            }
        };
        $this->assertTrue($blocked('id = ?', [$aCustomer]));                                      // tenant B waits on A's update
        $this->assertFalse($blocked('tenant_id = ? AND id = ?', [$a['tenantId'], $aCustomer]));   // one row locked
    }

    public function test_unfillable_attributes_throw_instead_of_being_dropped(): void
    {
        $m = $this->member();
        $other = $this->member();
        $this->expectException(MassAssignmentException::class);   // Model::shouldBeStrict(); in production tenant_id is dropped
        $this->inTenant($m, fn () => Customer::create(['full_name' => 'X', 'phone' => '0913000005', 'tenant_id' => $other['tenantId']]));
    }

    public function test_creating_takes_the_tenant_from_the_context(): void
    {
        $m = $this->member();
        $c = $this->inTenant($m, fn () => Customer::create(['full_name' => 'X', 'phone' => '0913000006']));
        $this->assertSame($m['tenantId'], $c->tenant_id);
    }
}
