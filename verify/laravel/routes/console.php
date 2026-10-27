<?php

use Illuminate\Support\Facades\Schedule;

// One scan at a time (a cache lock); the 2–24 hour window tolerates a missed run
Schedule::command('reminders:enqueue')->everyTenMinutes()->withoutOverlapping();
