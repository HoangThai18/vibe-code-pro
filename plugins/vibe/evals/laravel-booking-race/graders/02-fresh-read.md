---
type: llm
focus:
  source: file
  path: app/Services/BookingService.php
---

PASS if the overlap check cannot read a stale snapshot: either the overlap query is itself a locking read (`lockForUpdate()` or `sharedLock()`), or the per-staff lock is the first query of the transaction and no plain SELECT (such as `Customer::findOrFail`) runs before it, or the transaction uses READ COMMITTED.
FAIL if a plain read (for example `Customer::findOrFail($customerId)`) still runs before the lock and the overlap check is a plain `exists()`: under MySQL's REPEATABLE READ the first read fixes the snapshot, so the check misses a booking committed while waiting for the lock.
