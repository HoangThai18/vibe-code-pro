<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCustomerRequest;
use App\Http\Requests\UpdateCustomerRequest;
use App\Http\Resources\CustomerResource;
use App\Models\Customer;
use App\Services\CustomerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class CustomerController
{
    public function __construct(private CustomerService $customers) {}

    public function index(Request $request): JsonResponse
    {
        $q = $request->validate(['limit' => ['integer', 'min:1', 'max:100'], 'cursor' => ['string']]);
        $page = $this->customers->list((int) ($q['limit'] ?? 20), $q['cursor'] ?? null);

        return response()->json([
            'data' => CustomerResource::collection($page->items()),
            'nextCursor' => $page->nextCursor()?->encode(),
        ]);
    }

    public function store(StoreCustomerRequest $request): JsonResponse
    {
        return (new CustomerResource($this->customers->create($request->columns())))->response()->setStatusCode(201);
    }

    // {customer} is resolved by route model binding, inside the tenant scope: another tenant's id → 404
    public function show(Customer $customer): CustomerResource
    {
        Gate::authorize('customer.read');

        return new CustomerResource($customer);
    }

    public function update(UpdateCustomerRequest $request, Customer $customer): CustomerResource
    {
        return new CustomerResource($this->customers->update($customer, $request->columns()));
    }
}
