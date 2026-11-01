-- Echelons: a company user is in the front (opens events, fills lists) or
-- the rear (marks statuses and comments, nothing else). They switch
-- themselves; an admin or the company's super user sets it for them. A list
-- the front opens notifies the rear. Runs after test_flows.sql and uses its
-- users: 01 the admin, 02 a customer of c1, 03 of c2, 04 the store's (a1)
-- supplier, 05 the kitchen's (a2).
set client_min_messages = warning;
create function tst.rear_req(p_key text) returns requests language sql as $$
  select * from requests where id = (select v from tst.t where k = p_key)
$$;
grant execute on function tst.rear_req to authenticated;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000081', 'rear@x.il'),
  ('10000000-0000-0000-0000-000000000082', 'front@x.il');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000081');
select register_profile('עומר', 'חיים', '1234650', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000082');
select register_profile('יואב', 'שחר', '1234651', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000081');
select approve_user('10000000-0000-0000-0000-000000000082');

-- Setting the echelon ------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000081');
select tst.ok(my_echelon() = 'front', 'a company user starts in the front');
select set_echelon('10000000-0000-0000-0000-000000000081', 'rear');
select tst.ok(my_echelon() = 'rear', 'a company user moves itself to the rear');
select tst.fails($$select set_echelon('10000000-0000-0000-0000-000000000082', 'rear')$$,
  'a company user sets another user''s echelon');

select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(my_echelon() is null, 'an admin has no echelon');
select set_echelon('10000000-0000-0000-0000-000000000082', 'rear');
select tst.ok((select echelon from users where id = '10000000-0000-0000-0000-000000000082') = 'rear',
  'an admin sets a company user''s echelon');
select tst.fails($$select set_echelon('10000000-0000-0000-0000-000000000004', 'rear')$$,
  'a supplier gets an echelon');

-- The company's super user sets it for its own company only.
select set_super_user('10000000-0000-0000-0000-000000000002', true);
select tst.act('10000000-0000-0000-0000-000000000002');
select set_echelon('10000000-0000-0000-0000-000000000082', 'front');
select tst.ok((select echelon from users where id = '10000000-0000-0000-0000-000000000082') = 'front',
  'a company''s super user sets its users'' echelon');
select tst.fails($$select set_echelon('10000000-0000-0000-0000-000000000003', 'rear')$$,
  'a super user sets the echelon of another company''s user');
select tst.act('10000000-0000-0000-0000-000000000001');
select set_super_user('10000000-0000-0000-0000-000000000002', false);

-- A new list notifies the rear ---------------------------------------------------
reset role;
create temp table rear_outbox_before as select coalesce(max(id), 0) as id from notification_outbox;
grant select on rear_outbox_before to authenticated;
set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000004');
insert into tst.t select 'r_item', add_catalog_item('00000000-0000-0000-0000-0000000000a1', 'מים לאיסוף');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'r_ev', create_event('איסוף מהמחסן', 'company');
insert into tst.t select 'r_list', id from lists where event_id = (select v from tst.t where k = 'r_ev');

reset role;
select tst.ok((select array_agg(target_user) from notification_outbox
               where kind = 'new_list' and id > (select id from rear_outbox_before))
  = '{10000000-0000-0000-0000-000000000081}', 'a new list notifies the company''s rear, and only it');
select tst.ok((select body from notification_outbox where kind = 'new_list' and id > (select id from rear_outbox_before))
  = 'רשימה חדשה לאיסוף: איסוף מהמחסן', 'the new list notification names the event');
set role authenticated;

-- The front adds requests; the rear marks them -----------------------------------------
insert into tst.t select 'r_req', gen_random_uuid();
insert into tst.t select 'r_req2', gen_random_uuid();
insert into requests (id, list_id, item_id, quantity)
select r.v, l.v, i.v, 4 from tst.t l, tst.t i, tst.t r
where l.k = 'r_list' and i.k = 'r_item' and r.k in ('r_req', 'r_req2');
select tst.ok((tst.rear_req('r_req')).status_set_at is null, 'a new request has no status setter');

select tst.act('10000000-0000-0000-0000-000000000081');
select tst.ok((select count(*) from requests where list_id = (select v from tst.t where k = 'r_list')) = 2,
  'the rear sees its company''s requests');
update requests set status = 'ready' where id = (select v from tst.t where k = 'r_req');
select tst.ok((tst.rear_req('r_req')).status = 'ready', 'the rear marks a request ready');
select tst.ok((tst.rear_req('r_req')).status_set_by_echelon = 'rear'
  and (tst.rear_req('r_req')).status_set_by_unit = '00000000-0000-0000-0000-0000000000c1'
  and (tst.rear_req('r_req')).status_set_at is not null, 'the request remembers the rear set its status');
update requests set status = 'collected' where id = (select v from tst.t where k = 'r_req');
select restore_request(v) from tst.t where k = 'r_req';
select tst.ok((tst.rear_req('r_req')).status = 'ready', 'the rear unmarks a pickup');
select mark_collected((select v from tst.t where k = 'r_list'), '00000000-0000-0000-0000-0000000000a1');
select tst.ok((tst.rear_req('r_req')).status = 'collected', 'the rear collects a supplier''s section');
select restore_request(v) from tst.t where k = 'r_req';

select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'missing' where id = (select v from tst.t where k = 'r_req2');
select tst.ok((tst.rear_req('r_req2')).status_set_by_unit = '00000000-0000-0000-0000-0000000000a1'
  and (tst.rear_req('r_req2')).status_set_by_echelon is null, 'a supplier''s mark records its unit and no echelon');
update requests set status_set_by_echelon = 'rear' where id = (select v from tst.t where k = 'r_req2');
select tst.ok((tst.rear_req('r_req2')).status_set_by_echelon is null, 'a client cannot forge who set the status');

-- Should fail: the rear adds, edits, deletes or restores requests, and opens,
-- closes or cancels events.
select tst.act('10000000-0000-0000-0000-000000000081');
select tst.fails($$insert into requests (list_id, item_id, quantity)
  select l.v, i.v, 1 from tst.t l, tst.t i where l.k = 'r_list' and i.k = 'r_item'$$, 'the rear adds a request');
select tst.fails($$update requests set quantity = 9 where id = (select v from tst.t where k = 'r_req')$$,
  'the rear changes a quantity');
select tst.fails($$update requests set urgent = true where id = (select v from tst.t where k = 'r_req')$$,
  'the rear flags a request urgent');
select tst.fails($$update requests set customer_note = 'x' where id = (select v from tst.t where k = 'r_req')$$,
  'the rear writes the company note');
select tst.fails($$select delete_request(v) from tst.t where k = 'r_req'$$, 'the rear deletes a ready request');
update requests set status = 'pending' where id = (select v from tst.t where k = 'r_req');
select tst.fails($$select delete_request(v) from tst.t where k = 'r_req'$$, 'the rear deletes a pending request');
select tst.ok((tst.rear_req('r_req')).status = 'pending', 'the rear''s delete leaves the request');
select tst.fails($$select create_event('x', 'company')$$, 'the rear opens an event');
select tst.fails($$select duplicate_event(v, 'x') from tst.t where k = 'r_ev'$$, 'the rear duplicates an event');
select tst.fails($$select close_event(v) from tst.t where k = 'r_ev'$$, 'the rear closes an event');
select tst.fails($$select cancel_event(v) from tst.t where k = 'r_ev'$$, 'the rear cancels an event');

-- The front's delete of a ready request cancels it; only the front restores it.
update requests set status = 'ready' where id = (select v from tst.t where k = 'r_req');
select tst.act('10000000-0000-0000-0000-000000000002');
select delete_request(v) from tst.t where k = 'r_req';
select tst.act('10000000-0000-0000-0000-000000000081');
select tst.fails($$select restore_request(v) from tst.t where k = 'r_req'$$, 'the rear restores a cancelled request');
select tst.act('10000000-0000-0000-0000-000000000002');
select restore_request(v) from tst.t where k = 'r_req';
select tst.ok((tst.rear_req('r_req')).status = 'ready', 'the front restores it');

-- Switching back to the front gives the rights back.
select tst.act('10000000-0000-0000-0000-000000000081');
select set_echelon('10000000-0000-0000-0000-000000000081', 'front');
update requests set urgent = true where id = (select v from tst.t where k = 'r_req');
select tst.ok((tst.rear_req('r_req')).urgent, 'back in the front, the user edits requests');
select set_echelon('10000000-0000-0000-0000-000000000081', 'rear');

-- Comments: by request, with the writer's echelon -------------------------------
insert into tst.t select 'r_cm', gen_random_uuid();
insert into list_comments (id, list_id, request_id, body)
select (select v from tst.t where k = 'r_cm'), l.v, r.v, 'לא מצאתי במדף' from tst.t l, tst.t r where l.k = 'r_list' and r.k = 'r_req';
select tst.ok(echelon = 'rear' and side = 'customer' and supplier_id = '00000000-0000-0000-0000-0000000000a1',
  'a rear comment on a request carries the echelon and the request''s supplier')
from list_comments where id = (select v from tst.t where k = 'r_cm');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into list_comments (list_id, body) select v, 'נגיע ב-10:00' from tst.t where k = 'r_list';
select tst.ok((select echelon from list_comments where body = 'נגיע ב-10:00') = 'front', 'a front comment carries the front');
select tst.ok(exists (select 1 from list_comments where id = (select v from tst.t where k = 'r_cm')),
  'the front sees the rear''s comment');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok(exists (select 1 from list_comments where id = (select v from tst.t where k = 'r_cm')),
  'the request''s supplier sees the comment on it');
insert into list_comments (list_id, request_id, body) select l.v, r.v, 'במדף השני' from tst.t l, tst.t r where l.k = 'r_list' and r.k = 'r_req';
select tst.ok((select echelon is null and side = 'supplier' from list_comments where body = 'במדף השני'),
  'a supplier answers on the request, with no echelon');
select tst.act('10000000-0000-0000-0000-000000000005');
select tst.ok(not exists (select 1 from list_comments where id = (select v from tst.t where k = 'r_cm')),
  'another supplier does not see it');
select tst.act('10000000-0000-0000-0000-000000000081');
select tst.fails($$insert into list_comments (list_id, request_id, body)
  select l.id, r.v, 'x' from lists l, tst.t r where l.event_id <> (select v from tst.t where k = 'r_ev')
    and l.company_id = '00000000-0000-0000-0000-0000000000c1' and r.k = 'r_req' limit 1$$,
  'a comment on a request of another list');

-- A request moved to another supplier unit takes its comments along.
reset role;
update requests set supplier_id = '00000000-0000-0000-0000-0000000000a2' where id = (select v from tst.t where k = 'r_req');
select tst.ok((select supplier_id from list_comments where id = (select v from tst.t where k = 'r_cm'))
  = '00000000-0000-0000-0000-0000000000a2', 'a moved request takes its comments to the new supplier');
update requests set supplier_id = '00000000-0000-0000-0000-0000000000a1' where id = (select v from tst.t where k = 'r_req');
