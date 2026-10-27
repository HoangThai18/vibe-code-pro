<?php

namespace App\Services;

use App\Models\Customer;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Support\Facades\Gate;

// Use cases: HTTP, jobs and commands all come through here, so the permission checks live here
final class CustomerService
{
    public function list(int $limit, ?string $cursor): CursorPaginator
    {
        Gate::authorize('customer.read');

        return Customer::query()->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($limit, cursor: $cursor);
    }

    public function create(array $columns): Customer
    {
        Gate::authorize('customer.write');

        return Customer::create($columns);   // duplicate phone in this tenant → 409 customer_phone_taken
    }

    public function update(Customer $customer, array $columns): Customer
    {
        Gate::authorize('customer.write');
        $customer->update($columns);

        return $customer;
    }
}
