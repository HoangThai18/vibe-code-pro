---
type: llm
---

PASS if the response explains how module boundaries are kept: each module owns its tables and others use only its public interface, ideally enforced by a lint or dependency rule (for example eslint-plugin-boundaries, dependency-cruiser, import-linter, ArchUnit).
FAIL if boundaries are mentioned without any rule about data ownership or how they are enforced.
