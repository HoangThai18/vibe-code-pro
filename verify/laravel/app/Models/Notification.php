<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['appointment_id', 'kind', 'status', 'sent_at'])]
class Notification extends Model
{
    use BelongsToTenant, HasUuids;

    const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['sent_at' => 'immutable_datetime'];
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }
}
