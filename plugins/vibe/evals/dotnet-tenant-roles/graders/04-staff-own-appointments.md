---
type: llm
---

PASS if booking an appointment checks that a member with the `staff` role books only for themselves (`StaffUserId` equals the signed-in user), returning 403 otherwise, while owners and managers may book for any staff member.
FAIL otherwise.
