-- PostgREST returns at most 1,000 rows per request, so the Excel export
-- reads export_rows in pages. Paging needs an order with no ties: the body
-- is 20261028000012's, plus the request id at the end to break them.
create or replace view export_rows with (security_invoker = true) as
select
  e.id as event_id,
  e.name as event_name,
  e.needed_by,
  e.created_at as event_created_at,
  coalesce(e.cancelled_at, e.closed_at, e.created_at) as event_age_from,
  e.status as event_status,
  c.name as company_name,
  s.name as supplier_name,
  i.name as item_name,
  r.quantity,
  r.supplied_quantity,
  r.status,
  r.urgent,
  r.supplier_note,
  r.updated_at,
  r.supplier_id,
  r.company_id,
  e.needed_on,
  r.customer_note,
  r.measure,
  i.category as item_category,
  r.id as request_id
from requests r
join events e on e.id = r.event_id
join units c on c.id = r.company_id
join units s on s.id = r.supplier_id
join items i on i.id = r.item_id;
