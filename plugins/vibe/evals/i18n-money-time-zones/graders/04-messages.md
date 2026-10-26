---
type: llm
---

PASS if translations are whole sentences with named placeholders, and plurals follow each language's rules (Vietnamese needs only "other", English "one" and "other"), via ICU messages or i18next plurals.
FAIL if translated fragments are concatenated with values, or plurals are handled with if/else in code.
