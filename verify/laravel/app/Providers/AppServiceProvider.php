<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use App\Auth\Permissions;
use App\Models\User;
use App\Reminders\LogSmsSender;
use App\Reminders\SmsSender;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // scoped, not singleton: reset before every job a queue worker runs (and every Octane request)
        $this->app->scoped(TenantContext::class);
        $this->app->bind(SmsSender::class, LogSmsSender::class);
    }

    public function boot(): void
    {
        // uuid columns as CHAR(36) ascii_bin, as in references/mysql.md: binary comparison (200,000 key lookups
        // took 0.68 s against 0.96 s in utf8mb4_0900_ai_ci), and an uppercase id no longer equals the lowercase one
        Blueprint::macro('asciiUuid', function (string $column) {
            return $this->uuid($column)->charset('ascii')->collation('ascii_bin');
        });

        // Lazy loading (N+1), unfillable attributes and missing attributes throw outside production
        Model::shouldBeStrict(! $this->app->isProduction());

        // One ability per permission; the role is the membership's in the path tenant (ResolveTenant)
        foreach (Permissions::ACTIONS as $action) {
            Gate::define($action, fn (User $user) => Permissions::can($this->app->make(TenantContext::class)->role(), $action));
        }
    }
}
