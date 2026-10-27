<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['full_name', 'phone', 'email', 'birthday'])]   // never tenant_id
class Customer extends Model
{
    use BelongsToTenant, HasUuids;

    const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['birthday' => 'date:Y-m-d'];
    }
}
