<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['name', 'status', 'time_zone'])]
class Tenant extends Model
{
    use HasUuids;

    const UPDATED_AT = null;
}
