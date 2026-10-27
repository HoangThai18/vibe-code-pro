---
type: llm
---

PASS if permissions are named `resource.action` (at least `customer.read`, `customer.write`, `appointment.write`) in one place that maps each role to its permissions and denies anything not listed, every tenant endpoint declares the permission it needs, and a member whose role lacks it gets 403. The check must run after the membership is known (for example in the endpoint filter, or `IAuthorizationService.AuthorizeAsync` with the membership as the resource), not in a policy that runs before the membership is loaded.
FAIL if permissions are checked by role names scattered across endpoints, an endpoint has no permission, or a missing permission returns anything other than 403.
