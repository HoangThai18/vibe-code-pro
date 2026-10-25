---
type: llm
focus: trace
---

PASS if the trace shows a test for the đ/Đ case (such as slugify('Đường Lê Lợi') === 'duong-le-loi') being run and failing before src/slugify.js is changed, and the full node --test run passing after the fix.
FAIL if the fix is made without first seeing the new test fail, or the final test run is missing or failing.
