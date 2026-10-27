<?php

use App\Http\Controllers\AppointmentController;
use Illuminate\Support\Facades\Route;

Route::prefix('t/{tenant}')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::post('appointments', [AppointmentController::class, 'store']);
});
