-- Test schema: roles, tenants and helpers as in the vibe-backend RLS reference (references/postgres-rls.md)
create extension if not exists pgcrypto;
do $$ begin
  create role app_user login password 'app' nosuperuser nobypassrls;
exception when duplicate_object then null; end $$;
do $$ begin
  create role app_definer nologin nosuperuser bypassrls;   -- owns app_tenant_ids()
exception when duplicate_object then null; end $$;
grant usage on schema public to app_definer;
create or replace function app_current_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed'))
);
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_read on tenants for select using (id = (select app_current_tenant()));
-- Workers list tenants through this function: without a tenant context the app role sees no tenant rows
create function app_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.tenants where status = 'active' order by id
$$;
grant select (id, status) on tenants to app_definer;
alter function app_tenant_ids() owner to app_definer;
revoke execute on function app_tenant_ids() from public;
grant execute on function app_tenant_ids() to app_user;

create table customers (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  birthday date,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, phone)
);
create table appointments (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  staff_user_id uuid not null,                   -- memberships (tenant_id, user_id) in the app; not in this fixture
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'booked',
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references customers (tenant_id, id)
);
-- Stand-ins for the jobs enqueued in the same transaction (references/jobs.md): confirmation, staff alert
create table confirmations (tenant_id uuid not null, payment_id uuid not null unique);
create table reviews (tenant_id uuid not null, payment_id uuid not null);
do $$
declare t text;
begin
  foreach t in array array['customers', 'appointments', 'confirmations', 'reviews'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_current_tenant()))
                    with check (tenant_id = (select app_current_tenant()))', t);
  end loop;
end $$;
