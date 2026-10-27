<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

// Global (no tenant_id): one person can belong to several tenants through memberships
#[Fillable(['email', 'password'])]
#[Hidden(['password'])]
class User extends Authenticatable
{
    use HasApiTokens, HasUuids;

    const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['password' => 'hashed'];
    }
}
