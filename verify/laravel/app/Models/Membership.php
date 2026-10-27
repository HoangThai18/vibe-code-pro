<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// PRIMARY KEY (tenant_id, user_id); Eloquent keys on user_id and BelongsToTenant adds tenant_id
class Membership extends Model
{
    use BelongsToTenant;

    const UPDATED_AT = null;

    protected $primaryKey = 'user_id';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = ['user_id', 'role'];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
