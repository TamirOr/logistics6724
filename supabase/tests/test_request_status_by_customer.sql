-- Customers set a request's status like the supplier does, and mark a single
-- request collected from any open status. Their own changes send the company
-- no notification. Runs after test_flows.sql and uses its users: 02 is a
-- customer of c1, 04 the store's (a1) supplier.
set client_min_messages = warning;
-- The request stored under a tst.t key, as the caller sees it.
create function tst.req(p_key text) returns requests language sql as $$
  select * from requests where id = (select v from tst.t where k = p_key)
$$;
grant execute on function tst.req to authenticated;

set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000004');
insert into tst.t select 's_item', add_catalog_item('00000000-0000-0000-0000-0000000000a1', 'סוללה לבדיקה');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 's_ev', create_event('בדיקת סטטוס', 'company');
insert into tst.t select 's_req', gen_random_uuid();
insert into tst.t select 's_req2', gen_random_uuid();
insert into requests (id, list_id, item_id, quantity)
select r.v, l.id, i.v, 5 from lists l, tst.t i, tst.t r
where l.event_id = (select v from tst.t where k = 's_ev') and i.k = 's_item' and r.k in ('s_req', 's_req2');

reset role;
create temp table outbox_before as select count(*) as n from notification_outbox;
grant select on outbox_before to authenticated;
set role authenticated;

-- The supplier's statuses.
update requests set status = 'ready' where id = (select v from tst.t where k = 's_req');
select tst.ok((tst.req('s_req')).status = 'ready', 'customer marks ready');
update requests set status = 'partial', supplied_quantity = 2 where id = (select v from tst.t where k = 's_req');
select tst.ok((tst.req('s_req')).supplied_quantity = 2, 'customer marks partial with the supplied quantity');
update requests set status = 'ready' where id = (select v from tst.t where k = 's_req');
select tst.ok((tst.req('s_req')).supplied_quantity is null, 'leaving partial clears the supplied quantity');
update requests set status = 'missing' where id = (select v from tst.t where k = 's_req');
select tst.ok((tst.req('s_req')).status = 'missing', 'customer marks missing');
update requests set status = 'pending' where id = (select v from tst.t where k = 's_req');
select tst.ok((tst.req('s_req')).status = 'pending', 'customer returns a request to pending');

-- One request collected straight from pending, and unmarked.
update requests set status = 'collected' where id = (select v from tst.t where k = 's_req');
select tst.ok((tst.req('s_req')).status = 'collected' and (tst.req('s_req')).previous_status = 'pending',
  'customer collects a pending request');
select restore_request(v) from tst.t where k = 's_req';
select tst.ok((tst.req('s_req')).status = 'pending', 'unmarking returns it to pending');

-- The company's own marks notify nobody and queue no missing items.
update requests set status = 'missing' where id = (select v from tst.t where k = 's_req');
update requests set status = 'ready' where id = (select v from tst.t where k = 's_req2');
reset role;
select tst.ok((select count(*) from notification_outbox) = (select n from outbox_before),
  'a customer''s own status change sends no notification');
select tst.ok(not exists (select 1 from missing_queue_items where request_id = (select v from tst.t where k = 's_req')),
  'a customer''s missing mark is not queued');
set role authenticated;

-- The supplier's missing mark is still queued. With the other request
-- pending, no ready notification takes it in.
update requests set status = 'pending' where id in (select v from tst.t where k in ('s_req', 's_req2'));
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'missing' where id = (select v from tst.t where k = 's_req');
reset role;
select tst.ok(exists (select 1 from missing_queue_items where request_id = (select v from tst.t where k = 's_req')),
  'a supplier''s missing mark is queued');
set role authenticated;

-- Should fail: supplier fields, a supplied quantity without partial, a
-- cancel by update, partial without a quantity.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$update requests set supplier_note = 'x' where id = (select v from tst.t where k = 's_req')$$,
  'customer writes the supplier note');
select tst.fails($$update requests set status = 'ready', supplied_quantity = 2 where id = (select v from tst.t where k = 's_req')$$,
  'customer sets a supplied quantity without partial');
select tst.fails($$update requests set status = 'cancelled' where id = (select v from tst.t where k = 's_req')$$,
  'customer cancels a missing request by update');
select tst.fails($$update requests set status = 'partial' where id = (select v from tst.t where k = 's_req')$$,
  'partial needs a supplied quantity');

-- Should fail: another company's customer changes the status (RLS hides the row).
select tst.act('10000000-0000-0000-0000-000000000003');
update requests set status = 'ready' where id = (select v from tst.t where k = 's_req');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((tst.req('s_req')).status = 'missing', 'another company cannot change the status');

-- Should fail: a status change in a closed event.
select close_event(v) from tst.t where k = 's_ev';
select tst.fails($$update requests set status = 'pending' where id = (select v from tst.t where k = 's_req')$$,
  'customer changes a status in a closed event');

reset role;
drop function tst.req;
