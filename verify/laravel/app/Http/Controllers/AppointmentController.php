<?php

namespace App\Http\Controllers;

use App\Http\Requests\BookAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\Appointment;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

final class AppointmentController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('customer.read');
        $q = $request->validate(['from' => ['required', 'date'], 'to' => ['required', 'date', 'after:from']]);

        return AppointmentResource::collection(Appointment::query()
            ->with('customer')   // without it: one query per row, and preventLazyLoading throws outside production
            ->where('starts_at', '>=', CarbonImmutable::parse($q['from']))
            ->where('starts_at', '<', CarbonImmutable::parse($q['to']))
            ->orderBy('starts_at')->limit(200)->get());
    }

    public function store(BookAppointmentRequest $request, BookingService $booking): JsonResponse
    {
        $a = $booking->book($request->input('customerId'), $request->input('staffUserId'),
            CarbonImmutable::parse($request->input('startsAt')), CarbonImmutable::parse($request->input('endsAt')));

        return response()->json(['data' => ['id' => $a->id]], 201);
    }
}
