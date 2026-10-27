<?php

use App\Http\Controllers\CustomerController;
use Illuminate\Support\Facades\Route;

Route::prefix('t/{tenant}')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('customers', [CustomerController::class, 'index']);
    Route::post('customers', [CustomerController::class, 'store']);
    Route::get('customers/{customer}', [CustomerController::class, 'show']);
    Route::patch('customers/{customer}', [CustomerController::class, 'update']);
    Route::post('customers/export', [CustomerController::class, 'export']);
});
