<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    use BelongsToTenant, HasUuids;

    protected $fillable = ['full_name', 'phone', 'email', 'birthday'];

    protected function casts(): array
    {
        return ['birthday' => 'date'];
    }
}
