---
type: llm
---

PASS if the answer adds an automated check that fails when the Vietnamese and English catalogs differ in keys: a script or a CI step, shown as code or named as a concrete step (for example "a CI step `check:messages` that compares the keys of vi.json and en.json"). Checking placeholders or plural forms too, or a runtime fallback to Vietnamese for a missing English key, is a plus.
FAIL if there is no automated check that the catalogs match, only advice to translate carefully or review by hand.
