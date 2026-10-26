# Design principles, SOLID, patterns, refactoring

Principles are decision tools, not laws to follow mechanically. The question for every principle: "does applying it here make the code genuinely easier to understand, change and test, or does it just add a layer?"

## Contents
1. SOLID in practice
2. Other principles
3. Patterns to use and to avoid
4. Code smells and fixes
5. Refactoring rules

## 1. SOLID in practice

| Principle | In practice | Use when | Overdone when |
|---|---|---|---|
| **S**: one reason to change | Split by **who/what** forces the change (pricing rules vs invoice formatting), not by line count | One service holds several unrelated business areas; fixing one breaks another | Every function becomes a class |
| **O**: open for extension, closed for modification | At a real variation point (several fee calculations, several notification channels), add a new variant without editing old code | A genuine second variant exists | Building a plugin system for something with one way |
| **L**: substitutability | Every implementation of an interface (real adapter, test fake) keeps the same contract: same meaning of inputs, outputs, errors; no extra preconditions | Everywhere there is an interface, including composition instead of inheritance | Never: an LSP violation is a bug, especially a test fake behaving differently from the real thing |
| **I**: small, need-specific interfaces | A port like `Notifier.send()` instead of a 20-method interface | At module boundaries and external integrations | An interface for every internal class with one implementation |
| **D**: depend on abstractions | The business layer **defines** the interface (port) it needs; infrastructure implements it; dependencies point inward only. Passing the implementation via parameter/constructor (DI) is how | Boundaries with infrastructure and external services, places to swap in tests | Interfaces and injection for everything, pure functions included |

```ts
// Port defined by the business layer, for "direct charge" gateways (cards, linked wallets)
export interface PaymentGateway {
  charge(input: { amount: Money; idempotencyKey: string }): Promise<{ id: string }>;
}

export function makeConfirmAppointment(deps: { payments: PaymentGateway; repo: AppointmentRepo; now: () => Date }) {
  return async (id: string, deposit: Money, attemptId: string) => {
    const appt = await deps.repo.get(id);
    appt.assertCanConfirm();                       // 1. check state BEFORE charging
    await deps.payments.charge({                   // 2. one key per customer payment attempt
      amount: deposit,                             //    (a retry after a network error resends the same attemptId)
      idempotencyKey: `deposit:${id}:${attemptId}`,
    });
    appt.confirm(deposit, deps.now());
    await deps.repo.save(appt);                    // 3. save with a version check; on conflict, raise an error and reconcile the charge
  };
}
```

Switching to another "direct charge" provider = add a new adapter; the use case doesn't change. Testing = pass a fake gateway (which must behave exactly like the real one, per L).

Redirect or QR gateways (VNPay, MoMo, many domestic gateways) have no synchronous `charge()`: the flow is `createPayment()` → return a `redirectUrl` or QR code → customer pays → gateway calls back via **IPN/webhook**. The port is then `createPayment` + a webhook handler that verifies the signature, is idempotent (a duplicate callback never confirms twice), and only then moves the appointment to `confirmed`. Meanwhile the appointment waits in a pending-payment state with an auto-cancel deadline.

## 2. Other principles

- **KISS and YAGNI**: the simplest solution that meets current requirements; don't build for "maybe later".
- **DRY in moderation**: merge immediately when two places are **the same knowledge** (same business rule, same formula). Two pieces that only look alike but change for different reasons stay separate; for those, wait for the third repetition before abstracting.
- **Composition over inheritance**: combine behavior with small functions and objects; deep inheritance is hard to change.
- **Pure functions for business logic**: data in, result out, no I/O. Easy to test and understand; I/O stays at the edges (use case, repository).
- **Make invalid states unrepresentable**: union types, enums, value objects instead of several booleans (`isPaid` and `isCancelled` both `true` is meaningless).
- **Fail fast at the edge**: validate input as it enters the system; inside, trust the validated types.
- **Explicit over "magic"**: data flow is readable from the code; limit decorators, metaprogramming and hard-to-trace global state.
- **One-way dependencies**: business logic knows nothing of the web framework, ORM or UI.

## 3. Patterns to use and to avoid

Use where they fit:

| Pattern | For |
|---|---|
| Repository | Data access for one aggregate/module; easy to swap for a fake when testing use cases |
| Service / use case | One business action with orchestration and a transaction |
| Strategy (map of functions or objects) | Rules that vary by type: fee calculation, notification sending |
| Adapter | Wrapping an external API behind your own interface |
| State machine | Lifecycles with states and transition rules (orders, appointments, approvals) |
| Outbox | Emitting events or side effects without losing them on failure |
| Result type or error class with `code` | Clear business errors, mapped to HTTP in one place |

Avoid by default: multi-level inheritance, a generic repository for every table, service locator / global variables for dependencies, event sourcing without a clear need, abstract factories for things with one variant.

## 4. Code smells and fixes

| Smell | Usually because | Fix |
|---|---|---|
| Long function, deeply nested ifs | Does too much | Split by step; early guard clauses |
| `switch (type)` repeated in many places | Missing extension point | Strategy map or polymorphism |
| Boolean parameters (`send(true, false)`) | One function doing two jobs | Two functions, or a named options object |
| Primitives for business concepts (money as `number`, phone as `string` everywhere) | Missing value object | Value object with validation |
| One feature change touches 5 files in 5 modules | Wrong module boundaries | Consolidate into one module, or redraw the boundaries |
| "Giant" service (God class) | Not split by reason to change | Split by use case or subdomain |
| A function in module A uses only module B's data | Misplaced (feature envy) | Move it to module B; A calls it via the API |

## 5. Refactoring rules

- Refactoring changes structure **without changing behavior**: cover it with tests first (write characterization tests if missing), run tests after each small step.
- Keep refactor commits separate from feature commits.
- Refactor only within the task, or what's needed to make the task cleaner; anything bigger gets its own task card, and ask the user.
- Measure before and after when refactoring for performance.
