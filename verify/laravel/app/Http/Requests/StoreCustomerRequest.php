<?php

namespace App\Http\Requests;

use App\Support\Phone;
use Illuminate\Foundation\Http\FormRequest;
use Normalizer;

class StoreCustomerRequest extends FormRequest
{
    // authorize() runs for HTTP only: the permission check is in CustomerService, which every entry point calls

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('phone'))) {
            $this->merge(['phone' => Phone::normalize($this->input('phone'))]);
        }
        if (is_string($this->input('fullName'))) {   // NFC: MySQL can't CHECK it (multi-tenant.md has the Postgres CHECK)
            $this->merge(['fullName' => Normalizer::normalize(trim($this->input('fullName')), Normalizer::FORM_C)]);
        }
    }

    public function rules(): array
    {
        return [
            'fullName' => ['required', 'string', 'max:200'],
            'phone' => ['required', 'string', 'regex:/^0\d{9,10}$/'],
            'email' => ['nullable', 'email', 'max:255'],
            'birthday' => ['nullable', 'date_format:Y-m-d'],
            // No 'unique:customers,phone': that rule queries every tenant. UNIQUE (tenant_id, phone) answers 409.
        ];
    }

    // The columns to write: only validated keys, so tenantId (or anything else) in the body is dropped
    public function columns(): array
    {
        $map = ['fullName' => 'full_name', 'phone' => 'phone', 'email' => 'email', 'birthday' => 'birthday'];

        return collect($this->validated())->mapWithKeys(fn ($v, $k) => [$map[$k] => $v])->all();
    }
}
