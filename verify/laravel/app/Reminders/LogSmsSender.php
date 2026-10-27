<?php

namespace App\Reminders;

use Illuminate\Support\Facades\Log;

// Placeholder binding; the real provider client goes here (with a timeout shorter than the job's)
final class LogSmsSender implements SmsSender
{
    public function send(string $to, string $text, string $idempotencyKey): void
    {
        Log::info('sms', ['idempotency_key' => $idempotencyKey]);   // no phone or text in logs
    }
}
