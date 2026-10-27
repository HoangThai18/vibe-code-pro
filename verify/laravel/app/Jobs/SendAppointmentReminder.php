<?php
// app/Jobs/SendAppointmentReminder.php

namespace App\Jobs;

use App\Models\Notification;
use App\Models\Tenant;
use App\Reminders\ReminderText;
use App\Reminders\SmsSender;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

// Ids only, read inside the tenant when the job runs (models as properties are restored without global scopes)
final class SendAppointmentReminder implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 60;   // below the queue's retry_after (90 s), or a second worker takes the job

    public function __construct(public string $tenantId, public string $notificationId) {}

    public function backoff(): array
    {
        return [30, 120, 600, 1800];
    }

    public function handle(TenantContext $tenant, SmsSender $sms): void
    {
        $tenant->run($this->tenantId, function () use ($sms) {
            $n = Notification::query()->with('appointment.customer')->find($this->notificationId);
            if ($n?->status !== 'pending') {
                return;                                // sent, skipped, or not in this tenant
            }
            if (! in_array($n->appointment->status, ['booked', 'confirmed'], true)) {
                return $this->mark('skipped');         // cancelled after it was queued
            }
            $zone = Tenant::query()->whereKey($this->tenantId)->value('time_zone');
            // Outside any transaction; an exception here means a retry with the same key
            $sms->send($n->appointment->customer->phone, ReminderText::for($n->appointment, $zone), idempotencyKey: $n->id);
            $this->mark('sent');
        });
    }

    private function mark(string $status): void
    {
        Notification::query()->whereKey($this->notificationId)->where('status', 'pending')
            ->update(['status' => $status, 'sent_at' => $status === 'sent' ? now() : null]);
    }

    public function failed(?Throwable $e): void   // all tries used: the job is in failed_jobs; alert on it
    {
        Log::error('reminder failed', ['tenant_id' => $this->tenantId, 'notification_id' => $this->notificationId]);
    }
}
