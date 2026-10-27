<?php

namespace App\Providers;

use App\Support\CurrentTenant;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(CurrentTenant::class);
    }

    public function boot(): void
    {
        //
    }
}
