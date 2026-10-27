<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AppointmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'customer' => ['id' => $this->customer->id, 'fullName' => $this->customer->full_name],
            'staffUserId' => $this->staff_user_id,
            'startsAt' => $this->starts_at->utc()->toIso8601ZuluString(),
            'endsAt' => $this->ends_at->utc()->toIso8601ZuluString(),
            'status' => $this->status,
        ];
    }
}
