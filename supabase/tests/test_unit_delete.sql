-- Deleting a unit: only an admin, only once no user, list, request or event
-- uses it. Runs after test_flows.sql and uses its users: 01 is the admin,
-- 02 a customer of c1.
set client_min_messages = warning;

insert into units (id, name, kind) values
  ('00000000-0000-0000-0000-0000000000e1', 'פלוגה למחיקה', 'company'),
  ('00000000-0000-0000-0000-0000000000e2', 'אספקה למחיקה', 'supplier');
insert into items (id, supplier_id, name) values
  ('20000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'פריט של יחידה למחיקה');
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000041', 'deleted-unit@x.il');
insert into events (id, name, scope, needed_on)
values ('30000000-0000-0000-0000-0000000000e1', 'אירוע של יחידה למחיקה', 'company', current_date);
insert into lists (event_id, company_id) values
  ('30000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000041');
select register_profile('דן', 'רון', '1234599', 'customer', '00000000-0000-0000-0000-0000000000e1');

-- Should fail: a non-admin deletes, the unit has users, or events use it.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select delete_unit('00000000-0000-0000-0000-0000000000e2')$$, 'a customer cannot delete a unit');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select delete_unit('00000000-0000-0000-0000-0000000000e1')$$, 'a unit with users cannot be deleted');
select move_user('10000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000c1');
select tst.fails($$select delete_unit('00000000-0000-0000-0000-0000000000e1')$$, 'a unit an event uses cannot be deleted');

-- Once archiving removed its events, the admin deletes the company.
reset role;
delete from events where id = '30000000-0000-0000-0000-0000000000e1';
set role authenticated;
select delete_unit('00000000-0000-0000-0000-0000000000e1');
select tst.ok(not exists (select 1 from units where id = '00000000-0000-0000-0000-0000000000e1'), 'the admin deletes the company');

-- A supplier goes with its catalog.
select delete_unit('00000000-0000-0000-0000-0000000000e2');
select tst.ok(not exists (select 1 from units where id = '00000000-0000-0000-0000-0000000000e2'), 'the admin deletes the supplier');
select tst.ok(not exists (select 1 from items where id = '20000000-0000-0000-0000-0000000000e2'), 'its catalog goes with it');

-- Leave the shared fixtures as the later test files expect them.
reset role;
delete from users where id = '10000000-0000-0000-0000-000000000041';
delete from auth.users where id = '10000000-0000-0000-0000-000000000041';
