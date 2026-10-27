-- Performance (review): the supplier home loads only requests of open
-- events, the customer RLS filter has an index, and push-dispatch reads
-- its settings in one call.

-- Requests of open events. Runs with the caller's rights, so row-level
-- security still limits each user to their own requests.
create view open_requests with (security_invoker = true) as
select r.* from requests r
join events e on e.id = r.event_id
where e.status = 'open';

create index requests_company_idx on requests (company_id);

-- Several server-only settings at once.
create function server_configs(p_keys text[]) returns table (key text, value text)
language sql stable security definer set search_path = public as $$
  select c.key, c.value from app_config c where c.key = any (p_keys)
$$;
grant execute on function server_configs to service_role;

-- server_configs replaces the one-key server_config. Its last caller,
-- wake_dispatcher, reads the two settings it needs directly.
create or replace function wake_dispatcher() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from app_config where key = 'functions_url');
  v_secret text := (select value from app_config where key = 'cron_secret');
begin
  if v_url is not null and v_secret is not null
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb)'
      using v_url || '/push-dispatch',
            jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  end if;
  return null;
end $$;

drop function server_config(text);
