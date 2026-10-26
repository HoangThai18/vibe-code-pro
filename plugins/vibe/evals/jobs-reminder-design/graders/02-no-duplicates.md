---
type: llm
---

PASS if the design prevents duplicate SMS with a database-level guarantee (for example a notifications/reminders record with a UNIQUE constraint per appointment and kind, inserted with ON CONFLICT DO NOTHING), makes the send job idempotent (checks status before sending), and passes an idempotency key to the SMS provider or explains the crash-between-send-and-mark case.
FAIL if duplicate prevention relies only on a single scheduler instance, an in-memory flag, or a lock without a unique constraint.
