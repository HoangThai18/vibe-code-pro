<?php

namespace App\Support;

use RuntimeException;

class CurrentTenant
{
    private ?string $id = null;

    public function set(string $id): void
    {
        $this->id = $id;
    }

    public function id(): string
    {
        return $this->id ?? throw new RuntimeException('no tenant');
    }
}
