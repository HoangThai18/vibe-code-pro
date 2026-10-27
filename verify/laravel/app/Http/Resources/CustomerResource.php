<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CustomerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fullName' => $this->full_name,
            'phone' => $this->phone,
            'email' => $this->email,
            'birthday' => $this->birthday?->format('Y-m-d'),
            'createdAt' => $this->created_at->utc()->toIso8601ZuluString(),
        ];
    }
}
