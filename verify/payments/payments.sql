-- Payments for appointments (deposits) or invoices. Amounts are integer VND (no minor unit).
create table payments (
  tenant_id uuid not null references tenants(id),
  id uuid primary key default gen_random_uuid(),
  ref bigint generated always as identity unique,  -- what providers and customers see: vnp_TxnRef, transfer code SPA<ref>
  appointment_id uuid not null references appointments(id),
  provider text not null check (provider in ('vnpay', 'momo', 'bank_transfer')),
  amount bigint not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'needs_review', 'refunded')),
  provider_txn_id text,                             -- vnp_TransactionNo, MoMo transId, bank reference
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_txn_id),
  check ((status = 'paid') = (paid_at is not null) or status = 'refunded')
);
create index on payments (tenant_id, appointment_id);
create index on payments (status, expires_at) where status = 'pending';  -- reconciliation job

-- Every callback, kept for audit and to drop duplicate deliveries
create table payment_events (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,                          -- the provider's id for this notification
  payment_id uuid references payments(id),
  outcome text not null default 'received',
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (tenant_id, provider, event_key)
);

alter table payments enable row level security;
alter table payments force row level security;
create policy tenant_isolation on payments
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
alter table payment_events enable row level security;
alter table payment_events force row level security;
create policy tenant_isolation on payment_events
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
