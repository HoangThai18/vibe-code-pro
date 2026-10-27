<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Support\ApiError;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

final class TransactionTest extends TestCase
{
    // Route middleware gets the error already rendered as a response, so a transaction opened there commits
    public function test_a_transaction_in_middleware_commits_when_the_controller_throws(): void
    {
        $a = $this->member();
        Route::middleware(['api', 'auth:sanctum', 'tenant', WrapsInTransaction::class])->post('/v1/t/{tenant}/half-done', function () {
            Customer::create(['full_name' => 'Nửa chừng', 'phone' => '0916000001']);
            throw new ApiError(409, 'conflict', 'Xung đột.');
        });
        $this->as($a)->postJson("/v1/t/{$a['tenantId']}/half-done")->assertStatus(409);
        $this->assertSame(1, $this->countCustomers($a));   // the write before the error was committed
    }

    // DB::transaction() in the use case sees the exception and rolls back
    public function test_db_transaction_in_the_use_case_rolls_back(): void
    {
        $a = $this->member();
        try {
            $this->inTenant($a, fn () => DB::transaction(function () {
                Customer::create(['full_name' => 'Nửa chừng', 'phone' => '0916000002']);
                throw new ApiError(409, 'conflict', 'Xung đột.');
            }));
        } catch (ApiError) {
        }
        $this->assertSame(0, $this->countCustomers($a));
    }
}

class WrapsInTransaction
{
    public function handle($request, Closure $next)
    {
        return DB::transaction(fn () => $next($request));
    }
}
