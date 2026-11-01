-- A supplier in several units moves items, and their requests, between them.
-- Runs after test_flows.sql and uses its units and users: a1 the store, a2
-- the kitchen, 04 the store's supplier, 05 the kitchen's, 02 a customer,
-- 01 an admin. 71 is a new supplier in both.
set client_min_messages = warning;

insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000071', 'both@x.il');
insert into units (id, name, kind) values ('00000000-0000-0000-0000-0000000000a9', 'יחידה אחרת', 'supplier');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000071');
select register_profile('טל', 'שני', '1234590', 'supplier', '00000000-0000-0000-0000-0000000000a1',
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]);
select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000071');

select tst.act('10000000-0000-0000-0000-000000000071');
insert into tst.t select 'mv_water', add_catalog_item('00000000-0000-0000-0000-0000000000a1', 'מים מינרליים', 'שתייה-קרה');
insert into tst.t select 'mv_cola', add_catalog_item('00000000-0000-0000-0000-0000000000a1', 'קולה', 'שתייה-קרה');
insert into tst.t select 'mv_cups', add_catalog_item('00000000-0000-0000-0000-0000000000a1', 'כוסות חד פעמיות');
insert into tst.t select 'mv_cups_kitchen', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'כוסות חד פעמיות');
insert into tst.t select 'mv_kitchen_drink', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'מיץ', 'שתייהקרה');

select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'mv_ev', create_event('העברת פריטים', 'company');
insert into tst.t select 'mv_list', id from lists where event_id = (select v from tst.t where k = 'mv_ev');
insert into requests (id, list_id, item_id, quantity) values
  ('20000000-0000-0000-0000-0000000007e1', (select v from tst.t where k = 'mv_list'), (select v from tst.t where k = 'mv_water'), 6),
  ('20000000-0000-0000-0000-0000000007e2', (select v from tst.t where k = 'mv_list'), (select v from tst.t where k = 'mv_cups'), 50);

select tst.act('10000000-0000-0000-0000-000000000071');
update requests set status = 'missing' where id = '20000000-0000-0000-0000-0000000007e1';

-- Should fail: anyone but a supplier of both units, an item or unit not
-- theirs, or changing an item's unit directly.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select move_items(array[(select v from tst.t where k = 'mv_water')], '00000000-0000-0000-0000-0000000000a2')$$,
  'a customer cannot move items');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails($$select move_items(array[(select v from tst.t where k = 'mv_water')], '00000000-0000-0000-0000-0000000000a2')$$,
  'a supplier cannot move items to a unit it is not in');
select tst.act('10000000-0000-0000-0000-000000000071');
select tst.fails($$select move_items(array[(select v from tst.t where k = 'mv_water')], '00000000-0000-0000-0000-0000000000a9')$$,
  'a supplier cannot move items to a third unit');
select tst.fails($$select move_items(array[(select v from tst.t where k = 'mv_water'), gen_random_uuid()], '00000000-0000-0000-0000-0000000000a2')$$,
  'an unknown item fails the whole move');
select tst.fails($$update items set supplier_id = '00000000-0000-0000-0000-0000000000a2' where id = (select v from tst.t where k = 'mv_water')$$,
  'a supplier cannot change an item''s unit directly');
reset role;
select tst.ok((select supplier_id from items where id = (select v from tst.t where k = 'mv_water')) = '00000000-0000-0000-0000-0000000000a1',
  'a refused move leaves the item where it was');
set role authenticated;

-- A category: the items move with their requests, and the category is
-- spelled like the target's.
select tst.act('10000000-0000-0000-0000-000000000071');
select move_items(array[(select v from tst.t where k = 'mv_water'), (select v from tst.t where k = 'mv_cola')],
  '00000000-0000-0000-0000-0000000000a2');
reset role;
select tst.ok((select count(*) from items where id in ((select v from tst.t where k = 'mv_water'), (select v from tst.t where k = 'mv_cola'))
  and supplier_id = '00000000-0000-0000-0000-0000000000a2' and category = 'שתייהקרה') = 2,
  'the category moves to the target, spelled like its own');
select tst.ok((select supplier_id from requests where id = '20000000-0000-0000-0000-0000000007e1') = '00000000-0000-0000-0000-0000000000a2',
  'the item''s request moves with it');
select tst.ok((select supplier_id from missing_queue_items where request_id = '20000000-0000-0000-0000-0000000007e1') = '00000000-0000-0000-0000-0000000000a2',
  'a waiting missing-items notice moves with it');
select tst.ok(not exists (select 1 from missing_queue where list_id = (select v from tst.t where k = 'mv_list')
  and supplier_id = '00000000-0000-0000-0000-0000000000a1'), 'and the old unit''s empty notice is dropped');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok(not exists (select 1 from requests where id = '20000000-0000-0000-0000-0000000007e1'),
  'the old unit''s supplier no longer sees the request');
select tst.act('10000000-0000-0000-0000-000000000005');
select tst.ok(exists (select 1 from requests where id = '20000000-0000-0000-0000-0000000007e1'),
  'the new unit''s supplier sees it');

-- An item the target already has merges into it.
select tst.act('10000000-0000-0000-0000-000000000071');
select move_items(array[(select v from tst.t where k = 'mv_cups')], '00000000-0000-0000-0000-0000000000a2');
reset role;
select tst.ok(not exists (select 1 from items where id = (select v from tst.t where k = 'mv_cups')),
  'a same-name item merges into the target''s');
select tst.ok((select (item_id, supplier_id) from requests where id = '20000000-0000-0000-0000-0000000007e2')
  = ((select v from tst.t where k = 'mv_cups_kitchen'), '00000000-0000-0000-0000-0000000000a2'::uuid),
  'its request now uses the target''s item');

-- Leave the shared fixtures as the later test files expect them.
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select cancel_event(v) from tst.t where k = 'mv_ev';
reset role;
