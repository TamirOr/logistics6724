-- Comments on a list: any number from both sides. The company writes to
-- every supplier or to one; a supplier writes as one of its units, on lists
-- that have requests for it. Runs after test_flows.sql and uses its users:
-- 02 is a customer of c1, 03 of c2, 04 the store's (a1) supplier, 05 the
-- kitchen's (a2).
set client_min_messages = warning;
set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000004');
insert into tst.t select 'cm_item', add_catalog_item('00000000-0000-0000-0000-0000000000a1', 'מטען להערות');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'cm_ev', create_event('בדיקת הערות', 'company');
insert into tst.t select 'cm_list', id from lists where event_id = (select v from tst.t where k = 'cm_ev');
insert into requests (list_id, item_id, quantity)
select (select v from tst.t where k = 'cm_list'), (select v from tst.t where k = 'cm_item'), 1;

-- The company writes a general comment and one to each supplier. The side
-- is the writer's, whatever the client sends.
insert into tst.t select 'cm_general', gen_random_uuid();
insert into list_comments (id, list_id, body, side)
select (select v from tst.t where k = 'cm_general'), v, '  נגיע ב-14:00 ', 'supplier' from tst.t where k = 'cm_list';
insert into list_comments (list_id, supplier_id, body) select v, '00000000-0000-0000-0000-0000000000a1', 'לאפסנאות' from tst.t where k = 'cm_list';
insert into list_comments (list_id, supplier_id, body) select v, '00000000-0000-0000-0000-0000000000a2', 'למטבח' from tst.t where k = 'cm_list';
select tst.ok(side = 'customer' and body = 'נגיע ב-14:00' and company_id = '00000000-0000-0000-0000-0000000000c1'
  and event_id = (select v from tst.t where k = 'cm_ev') and created_by = '10000000-0000-0000-0000-000000000002',
  'the server fills in the side, the list''s event and company, and the writer')
from list_comments where id = (select v from tst.t where k = 'cm_general');
select tst.ok((select count(*) from list_comments where list_id = (select v from tst.t where k = 'cm_list')) = 3,
  'a list holds several list_comments');

-- The store sees the general comment and its own, and answers.
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok((select array_agg(body order by body) from list_comments where list_id = (select v from tst.t where k = 'cm_list'))
  = '{לאפסנאות,נגיע ב-14:00}', 'a supplier sees the general list_comments and its own');
insert into list_comments (list_id, supplier_id, body) select v, '00000000-0000-0000-0000-0000000000a1', 'מוכן מ-12:00' from tst.t where k = 'cm_list';
select tst.ok(side = 'supplier', 'a supplier''s comment is on the supplier side') from list_comments where body = 'מוכן מ-12:00';

-- The kitchen has no requests in the list: it sees only what was written to it.
select tst.act('10000000-0000-0000-0000-000000000005');
select tst.ok((select array_agg(body) from list_comments where list_id = (select v from tst.t where k = 'cm_list')) = '{למטבח}',
  'a supplier without requests in the list sees only list_comments to it');

-- Should fail: a supplier writes without requests in the list, or as another supplier.
select tst.fails($$insert into list_comments (list_id, supplier_id, body)
  select v, '00000000-0000-0000-0000-0000000000a2', 'x' from tst.t where k = 'cm_list'$$,
  'supplier list_comments on a list without its requests');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails($$insert into list_comments (list_id, supplier_id, body)
  select v, '00000000-0000-0000-0000-0000000000a2', 'x' from tst.t where k = 'cm_list'$$,
  'supplier list_comments as another supplier');
select tst.fails($$insert into list_comments (list_id, body) select v, 'x' from tst.t where k = 'cm_list'$$,
  'supplier list_comments without its unit');

-- Should fail: another company reads or writes; edits; blank or oversized text.
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.ok(not exists (select 1 from list_comments where list_id = (select v from tst.t where k = 'cm_list')),
  'another company sees no list_comments');
select tst.fails($$insert into list_comments (list_id, body) select v, 'x' from tst.t where k = 'cm_list'$$,
  'another company list_comments');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$update list_comments set body = 'x' where id = (select v from tst.t where k = 'cm_general')$$, 'list_comments are not edited');
select tst.fails($$insert into list_comments (list_id, body) select v, '   ' from tst.t where k = 'cm_list'$$, 'blank comment');
select tst.fails($$insert into list_comments (list_id, body) select v, repeat('א', 501) from tst.t where k = 'cm_list'$$,
  'comment over 500 characters');
select tst.fails($$insert into list_comments (list_id, supplier_id, body)
  select v, '00000000-0000-0000-0000-0000000000c2', 'x' from tst.t where k = 'cm_list'$$, 'comment to a company as supplier');

-- Each side deletes only its own side's list_comments.
select tst.act('10000000-0000-0000-0000-000000000004');
delete from list_comments where id = (select v from tst.t where k = 'cm_general');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(exists (select 1 from list_comments where id = (select v from tst.t where k = 'cm_general')),
  'a supplier cannot delete the company''s comment');
delete from list_comments where body = 'מוכן מ-12:00';
select tst.ok(exists (select 1 from list_comments where body = 'מוכן מ-12:00'), 'the company cannot delete a supplier''s comment');
delete from list_comments where id = (select v from tst.t where k = 'cm_general');
select tst.ok(not exists (select 1 from list_comments where id = (select v from tst.t where k = 'cm_general')),
  'the company deletes its comment');

-- Should fail: list_comments on an event that is not open.
select cancel_event(v) from tst.t where k = 'cm_ev';
select tst.fails($$insert into list_comments (list_id, body) select v, 'x' from tst.t where k = 'cm_list'$$,
  'comment on a cancelled event');
select tst.fails($$delete from list_comments where body = 'לאפסנאות'$$, 'deleting a comment of a cancelled event');
reset role;
