<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class BookAppointmentRequest extends FormRequest
{
    public function rules(): array
    {
        // Shape only. Not 'exists:customers,id': it accepts another tenant's customer (TenantScopeBypassTest);
        // BookingService checks the customer inside the tenant, and the composite FK backs it up.
        return [
            'customerId' => ['required', 'uuid'],
            'staffUserId' => ['required', 'uuid'],
            'startsAt' => ['required', 'date_format:Y-m-d\TH:i:s\Z'],
            'endsAt' => ['required', 'date_format:Y-m-d\TH:i:s\Z', 'after:startsAt'],
        ];
    }
}
