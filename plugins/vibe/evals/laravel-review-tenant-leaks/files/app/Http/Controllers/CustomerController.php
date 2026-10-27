<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCustomerRequest;
use App\Http\Requests\UpdateCustomerRequest;
use App\Jobs\ExportCustomersCsv;
use App\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class CustomerController extends Controller
{
    public function index(Request $request)
    {
        $total = Cache::remember('customers:total', 300, fn () => Customer::count());

        return [
            'data' => Customer::query()->latest()->cursorPaginate(20)->items(),
            'total' => $total,
        ];
    }

    public function store(StoreCustomerRequest $request)
    {
        return response()->json(['data' => Customer::create($request->validated())], 201);
    }

    public function show(Customer $customer)
    {
        return ['data' => $customer];
    }

    public function update(UpdateCustomerRequest $request, Customer $customer)
    {
        $customer->update($request->validated());

        return ['data' => $customer];
    }

    public function export(Request $request)
    {
        ExportCustomersCsv::dispatch($request->user()->id);

        return response()->json(['status' => 'queued'], 202);
    }
}
