<?php

use App\Http\Controllers\AppointmentController;
use App\Http\Controllers\CustomerController;
use Illuminate\Support\Facades\Route;

// apiPrefix 'v1' (bootstrap/app.php): /v1/t/{tenant}/customers...
Route::prefix('t/{tenant}')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('customers', [CustomerController::class, 'index']);
    Route::post('customers', [CustomerController::class, 'store']);
    Route::get('customers/{customer}', [CustomerController::class, 'show']);
    Route::patch('customers/{customer}', [CustomerController::class, 'update']);
    Route::get('appointments', [AppointmentController::class, 'index']);
    Route::post('appointments', [AppointmentController::class, 'store']);
});
