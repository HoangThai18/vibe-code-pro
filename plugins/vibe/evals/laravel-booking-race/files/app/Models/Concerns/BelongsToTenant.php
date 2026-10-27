<?php

namespace App\Models\Concerns;

use App\Support\CurrentTenant;
use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenant
{
    protected static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', fn (Builder $q) => $q->where($q->qualifyColumn('tenant_id'), app(CurrentTenant::class)->id()));
        static::creating(fn ($model) => $model->tenant_id = app(CurrentTenant::class)->id());
    }
}
