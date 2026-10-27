<?php
// app/Http/Middleware/ResolveTenant.php

namespace App\Http\Middleware;

use App\Models\Membership;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

// /v1/t/{tenant}/...: the tenant comes from the path, the role from the membership. Runs after auth:sanctum
// and before SubstituteBindings (bootstrap/app.php), so {customer} is resolved inside the tenant scope.
final class ResolveTenant
{
    public function __construct(private TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = (string) $request->route('tenant');
        $request->route()->forgetParameter('tenant');   // controllers receive only their own parameters
        if (! Str::isUuid($tenantId)) {
            throw new NotFoundHttpException;             // malformed id: 404
        }

        $this->tenant->set($tenantId);
        // Through the tenant scope: only this tenant's membership rows, and only an active tenant
        $role = Membership::query()
            ->where('user_id', $request->user()->getAuthIdentifier())
            ->whereHas('tenant', fn ($q) => $q->where('status', 'active'))
            ->value('role');
        if ($role === null) {
            $this->tenant->clear();
            throw new NotFoundHttpException;             // not a member: 404, don't reveal that the tenant exists
        }
        $this->tenant->set($tenantId, $role);

        return $next($request);
    }
}
