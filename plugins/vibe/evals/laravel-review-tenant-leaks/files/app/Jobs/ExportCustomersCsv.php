<?php

namespace App\Jobs;

use App\Models\Customer;
use App\Models\User;
use App\Notifications\ExportReady;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

class ExportCustomersCsv implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $userId) {}

    public function handle(): void
    {
        $path = 'exports/customers-'.now()->format('Ymd').'.csv';
        $rows = ["full_name,phone,email"];
        foreach (Customer::query()->orderBy('full_name')->cursor() as $c) {
            $rows[] = implode(',', [$c->full_name, $c->phone, $c->email]);
        }
        Storage::put($path, implode("\n", $rows));

        User::findOrFail($this->userId)->notify(new ExportReady(Storage::temporaryUrl($path, now()->addHour())));
    }
}
