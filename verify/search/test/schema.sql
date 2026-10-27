-- Test schema: the same shape and roles as the vibe-backend RLS reference
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login password 'app' nosuperuser nobypassrls;
  end if;
end $$;
create table tenants (id uuid primary key default gen_random_uuid(), name text not null);
create table customers (
  tenant_id uuid not null references tenants(id),
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null
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
  customer_id uuid not null references customers(id),
  body text not null
);
alter table customer_notes enable row level security;
alter table customer_notes force row level security;
create policy tenant_isolation on customer_notes
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
grant select, insert, update, delete on customer_notes to app_user;
