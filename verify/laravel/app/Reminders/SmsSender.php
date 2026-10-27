<?php

namespace App\Reminders;

interface SmsSender
{
    // The provider accepts an idempotency key: resending with the same key sends no second message
    public function send(string $to, string $text, string $idempotencyKey): void;
}
