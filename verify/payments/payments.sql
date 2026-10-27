-- Each spa's own merchant credentials, sealed (references/app-security.md, "Tenant secrets")
create table payment_accounts (
  tenant_id uuid not null references tenants(id),
  provider text not null check (provider in ('vnpay', 'momo', 'bank_transfer')),
  credentials_sealed bytea not null,                -- sealSecret(JSON.stringify(credentials), key)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider)
);

-- Payments for appointments (deposits) or invoices. Amounts are integer VND (no minor unit).
create table payments (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  ref text not null check (ref ~ '^[0-9A-HJKMNP-TV-Z]{9}$'), -- newPaymentCode(): vnp_TxnRef, transfer note SPA<ref>
  appointment_id uuid not null,
  provider text not null check (provider in ('vnpay', 'momo', 'bank_transfer')),
  amount bigint not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'needs_review', 'refunded')),
  provider_txn_id text,                             -- vnp_TransactionNo, MoMo transId, bank reference
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),    -- also vnp_CreateDate: querydr and refunds send it back
  primary key (tenant_id, id),
  unique (tenant_id, ref),
  unique (tenant_id, provider, provider_txn_id),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id),
  check ((status = 'paid') = (paid_at is not null) or status = 'refunded')
);
create index on payments (tenant_id, appointment_id);
create index on payments (tenant_id, expires_at) where status in ('pending', 'needs_review'); -- reconciliation job

-- Every callback, kept for audit and to drop duplicate deliveries
create table payment_events (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,                          -- the provider's id for this notification
  payment_id uuid,
  outcome text not null default 'received',
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (tenant_id, provider, event_key),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id)
);

-- One row per refund request; its id (without dashes) is vnp_RequestId
create table refunds (
  tenant_id uuid not null default app_current_tenant() references tenants(id),
  id uuid not null default gen_random_uuid(),
  payment_id uuid not null,
  amount bigint not null check (amount > 0),
  status text not null default 'requested'
    check (status in ('requested', 'sending', 'succeeded', 'failed', 'needs_review')),
  requested_by uuid not null,
  sent_at timestamptz,                              -- last attempt; while 'sending' the outcome is unknown
  provider_txn_id text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id)
);
create index on refunds (tenant_id, payment_id);

do $$
declare t text;
begin
  foreach t in array array['payment_accounts', 'payments', 'payment_events', 'refunds'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_current_tenant()))
                    with check (tenant_id = (select app_current_tenant()))', t);
  end loop;
end $$;
