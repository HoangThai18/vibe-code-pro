<?php
// app/Tenancy/PostgresTenant.php

namespace App\Tenancy;

use Closure;
use Illuminate\Support\Facades\DB;

// PostgreSQL with RLS: each request or job is one transaction whose first statement sets the tenant.
// set_config(..., true) ends with the transaction; a session-level SET stays on the connection, and Laravel keeps
// one connection per process for every job of a queue worker (and every request of an Octane worker, or of an
// FPM worker with PDO::ATTR_PERSISTENT).
final class PostgresTenant
{
    public static function run(string $tenantId, Closure $fn, string $connection = 'pgsql_app'): mixed
    {
        return DB::connection($connection)->transaction(function () use ($tenantId, $fn, $connection) {
            DB::connection($connection)->select("SELECT set_config('app.tenant_id', ?, true)", [$tenantId]);

            return $fn(DB::connection($connection));
        });
    }
}
