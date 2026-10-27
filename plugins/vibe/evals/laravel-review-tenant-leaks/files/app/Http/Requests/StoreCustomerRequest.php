<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return in_array(app(\App\Support\CurrentTenant::class)->role, ['owner', 'manager'], true);
    }

    protected function prepareForValidation(): void
    {
        $this->merge(['phone' => preg_replace('/\D/', '', (string) $this->input('phone'))]);
    }

    public function rules(): array
    {
        return [
            'full_name' => ['required', 'string', 'max:200'],
            'phone' => ['required', 'regex:/^0\d{9,10}$/', Rule::unique('customers', 'phone')],
            'email' => ['nullable', 'email'],
            'birthday' => ['nullable', 'date'],
        ];
    }
}
