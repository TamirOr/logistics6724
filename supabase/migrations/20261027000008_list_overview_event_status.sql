-- Home screens load open events and their list counts in parallel, so the
-- counts view carries the event's status to filter on. A replaced view may
-- only add columns at the end.
create or replace view list_overview with (security_invoker = true) as
select l.id, l.event_id, l.company_id, u.name as company_name,
  c.n_total, c.n_pending, c.n_ready, c.n_partial, c.n_missing, c.n_collected, c.n_cancelled,
  c.n_urgent,
  derive_list_status(c.n_total, c.n_pending, c.n_ready, c.n_partial, c.n_missing, c.n_collected, c.n_cancelled) as status,
  c.last_update,
  e.status as event_status
from lists l
join units u on u.id = l.company_id
join events e on e.id = l.event_id
cross join lateral (
  select count(*)::int as n_total,
    count(*) filter (where r.status = 'pending')::int as n_pending,
    count(*) filter (where r.status = 'ready')::int as n_ready,
    count(*) filter (where r.status = 'partial')::int as n_partial,
    count(*) filter (where r.status = 'missing')::int as n_missing,
    count(*) filter (where r.status = 'collected')::int as n_collected,
    count(*) filter (where r.status = 'cancelled')::int as n_cancelled,
    count(*) filter (where r.urgent and r.status not in ('collected', 'cancelled'))::int as n_urgent,
    max(r.updated_at) as last_update
  from requests r where r.list_id = l.id
) c;
