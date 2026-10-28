-- Deleting a catalog item: only its supplier, only while no request uses it.
-- Runs after test_flows.sql and uses its users: 05 is the kitchen's (a2)
-- supplier, 04 the store's (a1), 02 a customer.
set client_min_messages = warning;
set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000005');
insert into tst.t select 'd_item', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'פריט למחיקה');
insert into item_aliases (item_id, alias) select v, 'כינוי למחיקה' from tst.t where k = 'd_item';

-- Should fail: a customer or another supplier deletes it, or a request uses it.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select delete_item((select v from tst.t where k = 'd_item'))$$, 'a customer cannot delete an item');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails($$select delete_item((select v from tst.t where k = 'd_item'))$$, 'another supplier cannot delete an item');

select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'd_ev', create_event('מחיקת פריט', 'company');
insert into requests (list_id, item_id, quantity)
select l.id, (select v from tst.t where k = 'd_item'), 2 from lists l where l.event_id = (select v from tst.t where k = 'd_ev');
select tst.act('10000000-0000-0000-0000-000000000005');
select tst.fails($$select delete_item((select v from tst.t where k = 'd_item'))$$, 'an item a request uses cannot be deleted');

-- Once no request uses it, its supplier deletes it with everything attached.
select tst.act('10000000-0000-0000-0000-000000000002');
delete from requests where item_id = (select v from tst.t where k = 'd_item');
select tst.act('10000000-0000-0000-0000-000000000005');
select delete_item(v) from tst.t where k = 'd_item';
select tst.ok(not exists (select 1 from items where id = (select v from tst.t where k = 'd_item')), 'the supplier deletes the item');
select tst.ok(not exists (select 1 from item_aliases where alias = 'כינוי למחיקה'), 'its aliases go with it');
select tst.ok(not exists (select 1 from default_quantities where item_id = (select v from tst.t where k = 'd_item')),
  'its default quantities go with it');

-- Leave the shared fixtures as the later test files expect them.
select tst.act('10000000-0000-0000-0000-000000000002');
select cancel_event(v) from tst.t where k = 'd_ev';
reset role;
