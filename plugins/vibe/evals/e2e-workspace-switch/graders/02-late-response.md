---
type: llm
focus:
  source: file
  path: tests/e2e/workspace-switch.spec.ts
---

PASS if the test logs in as the user who belongs to both workspaces, opens Spa Hoa Mai's customer list, switches the "Workspace" select to Spa Bạch Dương, makes Spa Hoa Mai's customer-list response arrive late (held or delayed with page.route until after the switch), and then asserts that Spa Bạch Dương's customer is visible and Spa Hoa Mai's customer "Nguyễn Thị A1" is not.
FAIL if it only checks the state right after switching without simulating a late response from the old workspace, or never asserts that the old workspace's customer is absent.
