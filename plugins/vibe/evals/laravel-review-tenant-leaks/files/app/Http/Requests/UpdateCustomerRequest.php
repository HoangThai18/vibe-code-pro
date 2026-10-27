<?php

namespace App\Http\Requests;

use Illuminate\Validation\Rule;

class UpdateCustomerRequest extends StoreCustomerRequest
{
    public function rules(): array
    {
        return [
            'full_name' => ['sometimes', 'string', 'max:200'],
            'phone' => ['sometimes', 'regex:/^0\d{9,10}$/', Rule::unique('customers', 'phone')->ignore($this->route('customer'))],
            'email' => ['sometimes', 'nullable', 'email'],
            'birthday' => ['sometimes', 'nullable', 'date'],
        ];
    }
}
