<?php

namespace App\Http\Controllers;

use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

class AppointmentController
{
    public function store(Request $request, BookingService $booking)
    {
        $data = $request->validate([
            'customer_id' => ['required', 'uuid'],
            'staff_user_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
        ]);
        $appointment = $booking->book($data['customer_id'], $data['staff_user_id'],
            CarbonImmutable::parse($data['starts_at']), CarbonImmutable::parse($data['ends_at']));

        return response()->json(['data' => ['id' => $appointment->id]], 201);
    }
}
