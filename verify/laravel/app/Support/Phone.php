<?php

namespace App\Support;

final class Phone
{
    // '+84 912 345 678', '84912345678', '0912.345.678' → '0912345678'; anything else stays as typed and fails validation
    public static function normalize(string $value): string
    {
        $d = preg_replace('/[\s.\-()]/', '', $value);
        if (str_starts_with($d, '+84')) {
            return '0'.substr($d, 3);
        }
        if (preg_match('/^84\d{9,10}$/', $d)) {
            return '0'.substr($d, 2);
        }

        return preg_match('/^[1-9]\d{8,9}$/', $d) ? '0'.$d : $d;
    }
}
