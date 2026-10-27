-- Accent-insensitive customer search. Needs: customers(tenant_id, id, full_name, phone) with RLS on tenant_id.
create extension if not exists unaccent;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- unaccent() is STABLE (it looks up its dictionary through search_path), so it cannot be used in an index.
-- This wrapper names the dictionary explicitly; on Supabase replace public. with extensions.
create or replace function f_unaccent(text) returns text
  language sql immutable parallel safe strict
  return public.unaccent('public.unaccent'::regdictionary, $1);

-- One normalization for the index and every query: 'Nguyễn Văn Đức' -> 'nguyen van duc'
create or replace function search_key(text) returns text
  language sql immutable parallel safe strict
  return lower(public.f_unaccent($1));

-- Large table in use: run these outside a transaction (CONCURRENTLY), one per migration
create index concurrently if not exists customers_name_search
  on customers using gin (tenant_id, search_key(full_name) gin_trgm_ops);
create index concurrently if not exists customers_phone_search
  on customers using gin (tenant_id, phone gin_trgm_ops);
-- The list page's index, in Vietnamese order. Short or very common words ('vy', 'thi') walk it
-- in name order instead of collecting every match.
create index concurrently if not exists customers_name_order
  on customers (tenant_id, full_name collate "vi-x-icu", id);

-- Under RLS the planner cannot use the trigram index for LIKE (textlike is not leakproof), so it
-- reads every row of the tenant. This function runs as a role that bypasses RLS and applies the
-- same tenant filter itself, so the index is used. It returns only id and name.
-- Creating a BYPASSRLS role needs superuser (or your provider's admin role).
do $$ begin
  if not exists (select from pg_roles where rolname = 'search_owner') then
    create role search_owner nologin bypassrls;
  end if;
end $$;
grant usage on schema public to search_owner;
grant select (tenant_id, id, full_name, phone) on customers to search_owner;

-- 'a%b' -> '%a\%b%': what the user typed is text, never a LIKE wildcard
create or replace function like_contains(text) returns text
  language sql immutable parallel safe strict
  return '%' || replace(replace(replace($1, '\', '\\'), '%', '\%'), '_', '\_') || '%';

create or replace function search_customers(q text, max_rows int default 20)
returns table (id uuid, full_name text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  tenant uuid := public.app_current_tenant();
  digits text := regexp_replace(q, '\D', '', 'g');
  words text[] := array(select w from unnest(string_to_array(lower(q), ' ')) w where w <> '' limit 5);
  cond text;
  rank_first text := '';
begin
  if tenant is null then
    raise exception 'search_customers: no tenant context';  -- never search across tenants
  end if;
  if q ~ '^[\d\s+.()-]+$' and length(digits) >= 4 then
    -- Phone: stored as 0912345678; accept +84 912 345 678 and 84912345678
    digits := regexp_replace(digits, '^84(?=\d{9}$)', '0');
    cond := format('c.phone like %L', public.like_contains(digits));
  elsif cardinality(words) > 0 then
    -- Every word must match, in any order and without accents: 'anh dang' finds 'Đặng Thị Ánh'
    select string_agg(format('public.search_key(c.full_name) like %L',
                             public.like_contains(public.search_key(w))), ' and '),
           '(' || string_agg(format('lower(c.full_name) like %L', public.like_contains(w)), ' and ') || ') desc,'
      into cond, rank_first
      from unnest(words) w;
    -- Typed with accents: names that match as typed come first ('ánh' lists Ánh before Anh).
    -- Without accents, skip it: plain name order lets short and common words use the name index.
    if public.f_unaccent(q) = q then
      rank_first := '';
    end if;
  else
    return;
  end if;
  -- Vietnamese order (Ánh after An, Đ after D) needs the ICU collation; without ICU order by search_key
  return query execute format(
    'select c.id, c.full_name from public.customers c
      where c.tenant_id = $1 and %s
      order by %s c.full_name collate "vi-x-icu", c.id
      limit $2', cond, rank_first)
    using tenant, least(greatest(max_rows, 1), 50);
end
$$;

alter function search_customers(text, int) owner to search_owner;
revoke execute on function search_customers(text, int) from public;
grant execute on function search_customers(text, int) to app_user;
