---
type: llm
focus: files
---

PASS if phone normalization is defined in exactly one function outside the three modules (for example `src/shared/phone.js`), and the customers, staff and suppliers code all import and call that function.
FAIL if the supplier module has its own copy, imports the helper from inside the customers module, or any of the three modules still defines its own normalization.
