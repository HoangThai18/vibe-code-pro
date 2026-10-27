-- Marketing messages actually sent, per customer and channel: the 24-hour limit is counted from here
create table marketing_messages (
  tenant_id uuid not null default app_current_tenant() references tenants(id),
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  channel text not null check (channel in ('zalo', 'sms', 'email')),
  campaign_id uuid not null,
  sent_at timestamptz not null default now(),
  unique (campaign_id, customer_id, channel)               -- a retried job never sends a campaign twice
);
create index on marketing_messages (tenant_id, customer_id, channel, sent_at);
alter table marketing_messages enable row level security;
alter table marketing_messages force row level security;
create policy tenant_isolation on marketing_messages
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));

-- One Zalo OA token pair per tenant. Zalo rotates the refresh token on every use.
create table zalo_tokens (
  tenant_id uuid primary key default app_current_tenant() references tenants(id),
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  needs_reconnect boolean not null default false,          -- refresh failed: the spa must re-authorize the OA
  refresh_lease_until timestamptz,                          -- a refresh is in progress until then
  updated_at timestamptz not null default now()
);
alter table zalo_tokens enable row level security;
alter table zalo_tokens force row level security;
create policy tenant_isolation on zalo_tokens
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
