---
type: llm
focus:
  source: file
  path: app/Services/BookingService.php
---

PASS if the booking still runs in one DB::transaction and, before checking for overlaps, serializes bookings of the same staff member: `lockForUpdate()` (SELECT ... FOR UPDATE) on the staff member's membership or user row, or an equivalent per-staff lock that is held until the transaction ends. A per-slot table with a UNIQUE constraint also passes if every booked slot gets a row.
FAIL if the overlap check is still check-then-insert with no lock, relies on a UNIQUE on starts_at, or only adds FOR UPDATE to the overlap query itself (concurrent requests then deadlock on gap locks).
