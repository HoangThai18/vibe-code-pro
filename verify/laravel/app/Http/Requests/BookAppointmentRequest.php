<?php

namespace App\Http\Requests;

use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

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

    public function after(): array
    {
        return [function (Validator $v) {
            if ($v->errors()->isEmpty() && CarbonImmutable::parse($this->input('startsAt'))
                ->addHours(BookingService::MAX_HOURS)->lt(CarbonImmutable::parse($this->input('endsAt')))) {
                $v->errors()->add('endsAt', 'Lịch hẹn dài tối đa 12 giờ.');
            }
        }];
    }
}
