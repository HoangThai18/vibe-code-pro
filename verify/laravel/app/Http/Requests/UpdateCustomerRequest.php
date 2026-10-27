<?php

namespace App\Http\Requests;

// PATCH: an omitted field stays unchanged
class UpdateCustomerRequest extends StoreCustomerRequest
{
    public function rules(): array
    {
        return array_map(fn (array $rules) => ['sometimes', ...array_diff($rules, ['required'])], parent::rules());
    }
}
