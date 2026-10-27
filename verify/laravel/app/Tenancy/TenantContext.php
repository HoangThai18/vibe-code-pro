<?php
// app/Tenancy/TenantContext.php

namespace App\Tenancy;

use Closure;

// Bound with $this->app->scoped() (AppServiceProvider): queue workers and Octane reset scoped instances
// before each job or request. A singleton keeps the last tenant for the next job.
final class TenantContext
{
    private ?string $tenantId = null;

    private ?string $role = null;

    public function set(string $tenantId, ?string $role = null): void
    {
        [$this->tenantId, $this->role] = [$tenantId, $role];
    }

    public function clear(): void
    {
        $this->tenantId = $this->role = null;
    }

    public function id(): string
    {
        return $this->tenantId ?? throw new MissingTenantContext;   // fail closed, never "all tenants"
    }

    public function role(): ?string
    {
        return $this->role;
    }

    // Jobs and commands: run $fn as $tenantId, then restore what was there
    public function run(string $tenantId, Closure $fn): mixed
    {
        [$previousId, $previousRole] = [$this->tenantId, $this->role];
        $this->set($tenantId);
        try {
            return $fn();
        } finally {
            [$this->tenantId, $this->role] = [$previousId, $previousRole];
        }
    }

    public function cacheKey(string $key): string
    {
        return "t:{$this->id()}:{$key}";
    }

    public function storagePath(string $path): string
    {
        return "tenants/{$this->id()}/".ltrim($path, '/');
    }
}
