---
type: llm
focus:
  source: file
  path: tests/e2e/workspace-switch.spec.ts
---

PASS if elements are located the way a user perceives them (getByRole, getByLabel, getByText) and assertions are web-first (await expect(locator)...), with no CSS-class or XPath selectors.
FAIL if it relies on CSS classes, XPath or manual polling.
