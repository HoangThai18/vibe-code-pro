---
type: llm
---

PASS if the condition that lets a user see their own memberships (user_id equals the current user) appears only in a FOR SELECT policy, not in a FOR ALL policy and not in any INSERT, UPDATE or DELETE policy.
FAIL if a FOR ALL policy or a write policy contains the user-based OR branch, which would let a user modify memberships in other tenants.
