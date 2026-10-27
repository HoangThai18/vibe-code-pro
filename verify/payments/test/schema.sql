-- Test schema: roles and helpers as in the vibe-backend RLS reference
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login password 'app' nosuperuser nobypassrls;
  end if;
end $$;
create table tenants (id uuid primary key default gen_random_uuid(), name text not null);
create table appointments (
  tenant_id uuid not null references tenants(id),
  id uuid primary key default gen_random_uuid(),
  status text not null default 'booked'
);
create or replace function app_current_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
alter table appointments enable row level security;
alter table appointments force row level security;
create policy tenant_isolation on appointments
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
-- Stand-in for the confirmation job enqueued in the same transaction (references/jobs.md)
create table confirmations (tenant_id uuid not null, payment_id uuid not null unique);
alter table confirmations enable row level security;
alter table confirmations force row level security;
create policy tenant_isolation on confirmations using (tenant_id = (select app_current_tenant()));
