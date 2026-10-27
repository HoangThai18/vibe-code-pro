<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use RuntimeException;

// An error the client is meant to see: { "error": { "code", "message" } } (references/api-conventions.md section 2)
final class ApiError extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }

    public static function json(int $status, string $code, string $message, ?array $details = null): JsonResponse
    {
        return response()->json(['error' => array_filter(compact('code', 'message', 'details'), fn ($v) => $v !== null)], $status);
    }

    public function render(): JsonResponse
    {
        return self::json($this->status, $this->errorCode, $this->getMessage());
    }
}
