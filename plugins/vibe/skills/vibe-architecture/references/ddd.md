# DDD in moderation

Domain-Driven Design pays off when the hardest part of the software is the **business domain**, not the technology. For simple CRUD, full DDD only adds layers. In practice: always use the strategic part (shared language, boundaries), and use the tactical part (aggregates, value objects...) only for complex core domains.

## Contents
1. When it's worth it
2. Strategic: shared language, subdomains, bounded contexts
3. Tactical: value object, entity, aggregate, domain service, repository, domain event
4. Example: spa appointments
5. Common mistakes
6. DDD-lite for vibe projects

## 1. When it's worth it

Worth it when you see at least a few of these signs: many intertwined business rules; states and transitions that matter (booking, approval, payment); the same word meaning different things in different departments; rules that change often with business needs; getting a rule wrong loses money or customers.

## 2. Strategic

- **Ubiquitous language**: the glossary in `DOMAIN.md`, used verbatim in code, DB, API and UI. Rename a term, rename it everywhere.
- **Subdomains**: *core* (creates advantage, e.g. a scheduling algorithm), *supporting* (needed but not differentiating, e.g. staff management), *generic* (everyone has it, e.g. login, sending email: use an off-the-shelf solution). Invest design effort in the core.
- **Bounded context**: the scope in which a model and its terms mean one consistent thing. "Customer" in sales (buyer, receivables) differs from "customer" in support (complaint history). Each context is a module (later perhaps a service) with its own model, communicating via interfaces or events.

## 3. Tactical

- **Value object**: a value with no identity, immutable, validated on creation: `Money`, `PhoneNumber`, `DateRange`, `Email`. Replaces primitives so you never add VND to USD or store a malformed phone number.
- **Entity**: has identity and a lifecycle (`Customer`, `Appointment`).
- **Aggregate**: a cluster of entities and value objects kept consistent together, with one **root** as the only entry point for changes. Defaults: one transaction changes one aggregate; other aggregates are referenced by id; invariants are checked in the root; store a `version` column so two concurrent editors don't overwrite each other (optimistic locking). A sensible default, not a law: a business operation that must change two aggregates at once still uses one transaction.
- **Invariants spanning several aggregates must be enforced by the DB**: "check, then insert" in code leaks under two concurrent requests. Example, "a staff member never has two overlapping appointments":
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE appointments ADD CONSTRAINT no_staff_overlap
    EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status IN ('pending', 'confirmed'));
  ```
  If a constraint isn't possible, lock per staff member inside the transaction (`SELECT ... FOR UPDATE` on the staff row, or an advisory lock on `staff_id`). The domain service only gives a friendly error up front; the constraint is what actually blocks.
- **Domain service**: a rule involving several aggregates that belongs to none of them (e.g. package pricing, checking free slots to suggest times).
- **Repository**: one per aggregate root, taking and returning whole aggregates; no generic repository for every table.
- **Domain event**: a business fact that happened (`AppointmentConfirmed`), emitted after the state changes; other modules react (send a message, record revenue) via the outbox so no event is lost.
- **Application service / use case**: orchestrates one use: load the aggregate, call its behavior, save, emit events, manage the transaction. Contains no business rules.

## 4. Example: spa appointments

```ts
// domain/errors.ts: business errors with a code; the HTTP layer maps them to 409/422 (not 500)
export class DomainError extends Error {
  constructor(readonly code: string) { super(code); }
}

// domain/money.ts: immutable value object that validates itself
export class Money {
  private constructor(readonly amount: number, readonly currency: 'VND' | 'USD') {}
  static of(amount: number, currency: 'VND' | 'USD'): Money {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new DomainError('invalid_amount');
    return new Money(amount, currency);
  }
  static vnd(amount: number): Money { return Money.of(amount, 'VND'); }
  add(other: Money): Money {
    if (other.currency !== this.currency) throw new DomainError('currency_mismatch');
    return Money.of(this.amount + other.amount, this.currency);
  }
  equals(other: Money): boolean { return this.amount === other.amount && this.currency === other.currency; }
}

// domain/appointment.ts: aggregate root that owns the state transition rules (BR-xx in DOMAIN.md)
export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type AppointmentSnapshot = {
  id: string; tenantId: string; staffId: string; status: AppointmentStatus;
  startsAt: Date; endsAt: Date; depositAmount: number; version: number;
};

export type AppointmentEvent =
  | { type: 'AppointmentConfirmed'; tenantId: string; appointmentId: string; deposit: number; occurredAt: Date }
  | { type: 'AppointmentCancelled'; tenantId: string; appointmentId: string; refund: number; occurredAt: Date };

export class Appointment {
  private events: AppointmentEvent[] = [];
  private constructor(private state: AppointmentSnapshot) {}

  // Create: check the initial invariants
  static create(input: { id: string; tenantId: string; staffId: string; startsAt: Date; endsAt: Date }): Appointment {
    if (input.endsAt <= input.startsAt) throw new DomainError('invalid_time_range');
    return new Appointment({ ...input, status: 'pending', depositAmount: 0, version: 0 });
  }
  // Rebuild from the DB (used by the repository); skips the creation checks
  static rehydrate(snapshot: AppointmentSnapshot): Appointment { return new Appointment({ ...snapshot }); }
  snapshot(): AppointmentSnapshot { return { ...this.state }; }

  assertCanConfirm(): void {
    if (this.state.status !== 'pending') throw new DomainError('appointment_not_pending');
  }

  confirm(deposit: Money, now: Date): void {
    this.assertCanConfirm();
    this.state = { ...this.state, status: 'confirmed', depositAmount: deposit.amount };
    this.events.push({ type: 'AppointmentConfirmed', tenantId: this.state.tenantId, appointmentId: this.state.id, deposit: deposit.amount, occurredAt: now });
  }

  cancel(now: Date): void {
    const { status, startsAt, depositAmount } = this.state;
    if (status !== 'pending' && status !== 'confirmed') throw new DomainError('appointment_not_cancellable');
    const hoursLeft = (startsAt.getTime() - now.getTime()) / 3_600_000;
    const refund = status === 'confirmed' && hoursLeft >= 24 ? depositAmount : 0; // BR-07: cancelling at least 24h ahead refunds the deposit
    this.state = { ...this.state, status: 'cancelled' };
    this.events.push({ type: 'AppointmentCancelled', tenantId: this.state.tenantId, appointmentId: this.state.id, refund, occurredAt: now });
  }

  pullEvents(): AppointmentEvent[] { const e = this.events; this.events = []; return e; }
}
```

Use case `cancelAppointment`: in one transaction with tenant context, load the aggregate via the repository, call `cancel(now)`, save with `UPDATE ... WHERE id = $1 AND version = $2` (0 rows affected means a conflict), and write the events to the outbox table **in the same transaction**. The actual refund through the payment gateway is done by the worker reading the outbox after commit, with an idempotency key, because calling an external service inside a DB transaction is wrong (the `vibe-backend` skill, `references/data-layer.md` section 6). The "cancel at least 24h ahead, get the deposit back" rule lives in exactly one place and is unit-tested without a DB.

## 5. Common mistakes

- Full DDD for every module, CRUD included: many layers, no added value.
- Aggregates too large ("Customer" holding every order and appointment): heavy locking, slow. Split along real consistency boundaries.
- Business rules in controllers or SQL while entities are bags of data, in a domain that is complex.
- Using ORM models directly as domain objects and letting the framework drive the design. In TypeScript projects on Prisma/Drizzle, the practical approach is usually: plain types + pure domain functions (or a class like the one above) + a repository mapping between the two.

## 6. DDD-lite for vibe projects

Enough for most projects:

1. Glossary + `BR-xx` rules + state machine in `DOMAIN.md`.
2. Modules by bounded context.
3. Value objects for money, time, phone numbers, email.
4. State transitions in one domain function or class, unit-tested for every valid and invalid transition.
5. Domain events via outbox for side effects.

Add aggregates, domain services and per-aggregate repositories for the core domain only when these steps are no longer enough.
