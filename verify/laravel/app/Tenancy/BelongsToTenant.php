<?php
// app/Tenancy/BelongsToTenant.php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;

// Every model of a tenant-owned table. Covers Eloquent only: DB::table(), raw SQL and the unique:/exists:
// validation rules don't see it, and withoutGlobalScope('tenant') removes it.
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        // TenantContext::id() throws without a tenant: a forgotten context fails, it never reads every tenant
        static::addGlobalScope('tenant', fn (Builder $q) => $q->where($q->qualifyColumn('tenant_id'), app(TenantContext::class)->id()));
        // tenant_id always comes from the context, never from input
        static::creating(fn (self $model) => $model->setAttribute('tenant_id', app(TenantContext::class)->id()));
    }

    // save(), delete() and refresh() skip global scopes and filter by id only: with PRIMARY KEY (tenant_id, id)
    // MySQL scans the whole key for that, locking every row it reads
    protected function setKeysForSaveQuery($query): Builder
    {
        return parent::setKeysForSaveQuery($query)->where('tenant_id', $this->getOriginal('tenant_id'));
    }

    protected function setKeysForSelectQuery($query): Builder
    {
        return parent::setKeysForSelectQuery($query)->where('tenant_id', $this->getOriginal('tenant_id'));
    }
}
