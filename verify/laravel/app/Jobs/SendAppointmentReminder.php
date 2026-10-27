<?php
// app/Jobs/SendAppointmentReminder.php

namespace App\Jobs;

use App\Models\Notification;
use App\Models\Tenant;
use App\Reminders\SmsSender;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

// One job per appointment reminder. Ids only: data is read when the job runs, inside the tenant.
// Not models as properties: SerializesModels restores them without global scopes.
final class SendAppointmentReminder implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 60;   // below the database queue's retry_after (90 s), or a second worker takes the job

    public function __construct(public string $tenantId, public string $notificationId) {}

    public function backoff(): array
    {
        return [30, 120, 600, 1800];   // seconds before attempts 2, 3, 4, 5
    }

    public function handle(TenantContext $tenant, SmsSender $sms): void
    {
        $tenant->run($this->tenantId, fn () => $this->send($sms));
    }

    private function send(SmsSender $sms): void
    {
        $n = Notification::query()->with('appointment.customer')->find($this->notificationId);
        if ($n === null || $n->status !== 'pending') {
            return;                                   // already sent or skipped, or not in this tenant
        }
        $a = $n->appointment;
        if (! in_array($a->status, ['booked', 'confirmed'], true)) {
            $this->mark('skipped');                   // cancelled after it was queued
            return;
        }
        // Brandname SMS: unaccented template text (references/notifications.md); the time in the tenant's zone
        $zone = Tenant::query()->whereKey($this->tenantId)->value('time_zone');
        $text = 'Chao '.Str::ascii($a->customer->full_name).', nhac lich hen cua ban luc '
            .$a->starts_at->setTimezone($zone)->format('H:i d/m/Y').'.';
        $sms->send($a->customer->phone, $text, idempotencyKey: $n->id);   // no transaction open; throws → retried
        $this->mark('sent');
    }

    private function mark(string $status): void
    {
        Notification::query()->whereKey($this->notificationId)->where('status', 'pending')
            ->update(['status' => $status, 'sent_at' => $status === 'sent' ? now() : null]);
    }

    // Every try failed: the job is now in failed_jobs and the notification stays pending. Alert on it.
    public function failed(?Throwable $e): void
    {
        Log::error('reminder failed', ['tenant_id' => $this->tenantId, 'notification_id' => $this->notificationId]);
    }
}
