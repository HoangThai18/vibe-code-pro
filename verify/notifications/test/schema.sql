-- Test schema: roles and helpers as in the vibe-backend RLS reference
create extension if not exists pgcrypto;
do $$ begin
  create role app_user login password 'app' nosuperuser nobypassrls;
exception when duplicate_object then null; end $$;
create table tenants (id uuid primary key default gen_random_uuid(), name text not null);
create or replace function app_current_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
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
alter table customers enable row level security;
alter table customers force row level security;
create policy tenant_isolation on customers
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
