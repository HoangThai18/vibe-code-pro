<?php

namespace App\Http\Middleware;

use App\Models\Membership;
use App\Support\CurrentTenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetCurrentTenant
{
    public function __construct(private CurrentTenant $current) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = $request->route('tenant');
        $request->route()->forgetParameter('tenant');

        $membership = Membership::where('tenant_id', $tenantId)
            ->where('user_id', $request->user()->id)
            ->first();
        abort_if($membership === null, 404);

        $this->current->id = $tenantId;
        $this->current->role = $membership->role;

        return $next($request);
    }
}
