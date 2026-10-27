<?php

namespace App\Reminders;

use App\Models\Appointment;
use Illuminate\Support\Str;

final class ReminderText
{
    // Brandname SMS: unaccented template text (references/notifications.md); the time in the tenant's zone
    public static function for(Appointment $a, string $timeZone): string
    {
        return 'Chao '.Str::ascii($a->customer->full_name).', nhac lich hen cua ban luc '
            .$a->starts_at->setTimezone($timeZone)->format('H:i d/m/Y').'.';
    }
}
