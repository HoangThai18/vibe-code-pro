<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['customer_id', 'staff_user_id', 'starts_at', 'ends_at', 'status'])]
class Appointment extends Model
{
    use BelongsToTenant, HasUuids;

    const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['starts_at' => 'immutable_datetime', 'ends_at' => 'immutable_datetime'];
    }

    // Eager loads go through Customer's tenant scope too
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
