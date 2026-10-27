<?php

namespace Tests\Support;

use App\Reminders\SmsSender;
use RuntimeException;

final class FakeSms implements SmsSender
{
    public array $sent = [];

    public function __construct(public int $failures = 0) {}

    public function send(string $to, string $text, string $idempotencyKey): void
    {
        if ($this->failures-- > 0) {
            throw new RuntimeException('provider timeout');
        }
        $this->sent[] = compact('to', 'text', 'idempotencyKey');
    }
}
