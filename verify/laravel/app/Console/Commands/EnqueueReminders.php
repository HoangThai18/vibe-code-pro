<?php
// app/Console/Commands/EnqueueReminders.php

namespace App\Console\Commands;

use App\Jobs\SendAppointmentReminder;
use App\Models\Appointment;
use App\Models\Notification;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

// Scheduled every 10 minutes (routes/console.php). A command has no request, so no tenant: it lists the tenants
// (a global table) and does the rest inside each one.
final class EnqueueReminders extends Command
{
    protected $signature = 'reminders:enqueue';

    protected $description = 'Queue the 24-hour appointment reminders of every active tenant';

    public function handle(TenantContext $tenant): int
    {
        $queued = 0;
        foreach (Tenant::query()->where('status', 'active')->orderBy('id')->pluck('id') as $tenantId) {
            $queued += $tenant->run($tenantId, fn () => $this->enqueueFor($tenantId));
        }
        $this->info("queued {$queued}");

        return self::SUCCESS;
    }

    private function enqueueFor(string $tenantId): int
    {
        // Wide window (2 to 24 hours ahead) + UNIQUE: a missed run is caught up, nothing is sent twice
        $ids = Appointment::query()->whereIn('status', ['booked', 'confirmed'])
            ->where('starts_at', '>', now()->addHours(2))->where('starts_at', '<=', now()->addHours(24))
            ->pluck('id');
        $queued = 0;
        foreach ($ids as $appointmentId) {
            DB::transaction(function () use ($tenantId, $appointmentId, &$queued) {
                // INSERT first, SELECT on duplicate: two overlapping runs can't both create it
                $n = Notification::createOrFirst(['appointment_id' => $appointmentId, 'kind' => 'reminder_24h']);
                if ($n->wasRecentlyCreated) {
                    // The database queue writes the job on this connection: it commits or rolls back with the row
                    SendAppointmentReminder::dispatch($tenantId, $n->id);
                    $queued++;
                }
            });
        }

        return $queued;
    }
}
