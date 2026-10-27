<?php

namespace App\Models\Concerns;

use App\Support\CurrentTenant;
use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenant
{
    protected static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', function (Builder $query) {
            $tenantId = app(CurrentTenant::class)->id;
            if ($tenantId) {
                $query->where($query->qualifyColumn('tenant_id'), $tenantId);
            }
        });

        static::creating(function ($model) {
            $model->tenant_id ??= app(CurrentTenant::class)->id;
        });
    }
}
