-- Core schema: units, users, events, lists, requests, catalog.
-- Names follow the spec glossary.

-- Extensions live in their own schema (Supabase's layout), created before
-- the default privileges below so their functions stay callable.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- New functions are callable by nobody until granted. Each function the
-- app calls is granted to authenticated next to its definition, so a
-- server-only helper or secret is never exposed by accident.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

create type unit_kind as enum ('company', 'supplier');
create type user_role as enum ('customer', 'supplier', 'admin');
create type approval_status as enum ('pending', 'approved', 'rejected');
create type event_scope as enum ('company', 'battalion');
create type event_status as enum ('open', 'closed', 'cancelled');
create type request_status as enum ('pending', 'ready', 'partial', 'missing', 'collected', 'cancelled');

-- Text normalization for catalog search (spec: "Normalized search").
create function normalize_he(t text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
    translate(
      regexp_replace(
        regexp_replace(lower(t), '[֑-ׇ]', '', 'g'),
        '(ים|ות)(\s|$)', '\2', 'g'),
      'ךםןףץ׳''״"-', 'כמנפצ'),
    '\s+', ' ', 'g'))
$$;
grant execute on function normalize_he to authenticated;

create table units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  kind unit_kind not null,
  -- Order of supplier sections on the customer event screen. Admins set it.
  sort_order int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  service_number text not null check (service_number ~ '^[0-9]{5,9}$'),
  role user_role not null,
  unit_id uuid references units (id),
  approval approval_status not null default 'pending',
  rejection_reason text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references users (id),
  check ((role = 'admin') = (unit_id is null))
);
create index users_unit_idx on users (unit_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  scope event_scope not null,
  -- Time of day only. If it already passed when the event opened, it means tomorrow.
  needed_by time,
  -- needed_by resolved to a timestamp at creation, used for sorting.
  needed_at timestamptz,
  status event_status not null default 'open',
  created_by uuid references users (id) on delete set null,
  created_by_unit uuid references units (id),
  duplicated_from uuid references events (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  cancelled_at timestamptz
);
create index events_status_idx on events (status, created_at desc);

-- One company's requests inside one event.
create table lists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  company_id uuid not null references units (id),
  created_at timestamptz not null default now(),
  unique (event_id, company_id)
);
create index lists_company_idx on lists (company_id);

create table items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references units (id),
  name text not null check (btrim(name) <> ''),
  name_norm text generated always as (normalize_he(name)) stored,
  verified boolean not null default false,
  active boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index items_supplier_idx on items (supplier_id);
create index items_name_norm_trgm on items using gin (name_norm extensions.gin_trgm_ops);

create table item_aliases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  alias text not null,
  alias_norm text generated always as (normalize_he(alias)) stored,
  unique (item_id, alias)
);
create index item_aliases_norm_trgm on item_aliases using gin (alias_norm extensions.gin_trgm_ops);

create table requests (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists (id) on delete cascade,
  -- Copied from the list by trigger, for RLS and realtime filters.
  event_id uuid not null references events (id) on delete cascade,
  company_id uuid not null references units (id),
  supplier_id uuid not null references units (id),
  item_id uuid not null references items (id),
  quantity int not null check (quantity > 0),
  urgent boolean not null default false,
  status request_status not null default 'pending',
  -- Status before collected or cancelled, so either can be undone.
  previous_status request_status,
  supplied_quantity int check (supplied_quantity > 0),
  supplier_note text,
  changed_after_handling boolean not null default false,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (status <> 'partial' or (supplied_quantity is not null and supplied_quantity < quantity))
);
create index requests_list_idx on requests (list_id);
create index requests_event_idx on requests (event_id);
create index requests_supplier_status_idx on requests (supplier_id, status);
create index requests_item_idx on requests (item_id);

-- Last quantity each company requested per item. Survives archiving.
create table default_quantities (
  company_id uuid not null references units (id) on delete cascade,
  item_id uuid not null references items (id) on delete cascade,
  quantity int not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, item_id)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- Settings. Rows marked client_readable (tuning values, the VAPID public
-- key) are readable through config(); everything else (cron secret, VAPID
-- private key, functions URL) only through server_config(), which only the
-- service role can call. The deploy workflow fills in the URL and keys.
create table app_config (
  key text primary key,
  value text not null,
  client_readable boolean not null default false
);
insert into app_config (key, value, client_readable) values
  ('did_you_mean_threshold', '0.4', true),
  ('missing_window_minutes', '5', true),
  ('missing_window_cap_minutes', '15', true),
  ('retention_days', '90', true),
  ('timezone', 'Asia/Jerusalem', true);

-- Shared by pg_cron and the Edge Functions. Generated here so it never
-- leaves the database: gen_random_uuid draws from a strong random source.
insert into app_config (key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

create function config(k text, fallback text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_config where key = k and client_readable), fallback)
$$;
grant execute on function config to authenticated;

create function server_config(k text) returns text
language sql stable security definer set search_path = public as $$
  select value from app_config where key = k
$$;
grant execute on function server_config to service_role;
