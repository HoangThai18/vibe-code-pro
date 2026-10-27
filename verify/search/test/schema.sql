-- Test schema: the same shape and roles as the vibe-backend RLS reference
create extension if not exists pgcrypto;
do $$ begin
  create role app_user login password 'app' nosuperuser nobypassrls;
exception when duplicate_object then null; end $$;
create table tenants (id uuid primary key default gen_random_uuid(), name text not null);
create table customers (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  full_name text not null,
  phone text not null,                      -- stored as 0912345678
  email text,
  birthday date,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, phone)
);
create or replace function app_current_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
alter table customers enable row level security;
alter table customers force row level security;
create policy tenant_isolation on customers
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
grant usage on schema public to app_user;
grant select, insert, update, delete on customers, tenants to app_user;
create table customer_notes (
  tenant_id uuid not null references tenants(id),
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  body text not null,
  foreign key (tenant_id, customer_id) references customers (tenant_id, id)
);
alter table customer_notes enable row level security;
alter table customer_notes force row level security;
create policy tenant_isolation on customer_notes
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
grant select, insert, update, delete on customer_notes to app_user;
