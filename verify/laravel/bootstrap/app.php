<?php
// bootstrap/app.php

use App\Http\Middleware\ResolveTenant;
use App\Support\ApiErrors;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',   // Route::prefix('t/{tenant}')->middleware(['auth:sanctum', 'tenant'])
        apiPrefix: 'v1',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['tenant' => ResolveTenant::class]);
        // The api group's SubstituteBindings would otherwise run first and resolve {customer} outside the tenant
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class);
    })
    ->withExceptions(fn (Exceptions $exceptions) => ApiErrors::register($exceptions))
    ->create();
