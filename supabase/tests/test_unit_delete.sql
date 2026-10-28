-- Deleting a unit: only an admin, only once no user, list, request or event
-- uses it. Runs after test_flows.sql and uses its users: 01 is the admin,
-- 02 a customer of c1.
set client_min_messages = warning;

insert into units (id, name, kind) values
  ('00000000-0000-0000-0000-0000000000f1', 'פלוגה למחיקה', 'company'),
  ('00000000-0000-0000-0000-0000000000f2', 'אספקה למחיקה', 'supplier');
insert into items (id, supplier_id, name) values
  ('20000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', 'פריט של יחידה למחיקה');
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000041', 'deleted-unit@x.il'),
  ('10000000-0000-0000-0000-000000000042', 'second-admin@x.il');
select promote_admin('second-admin@x.il');
insert into events (id, name, scope, needed_on)
values ('30000000-0000-0000-0000-0000000000f1', 'אירוע של יחידה למחיקה', 'company', current_date);
insert into lists (event_id, company_id) values
  ('30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000041');
select register_profile('דן', 'רון', '1234599', 'customer', '00000000-0000-0000-0000-0000000000f1');

-- Should fail: a non-admin deletes, the unit has users, or events use it.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select delete_unit('00000000-0000-0000-0000-0000000000f2')$$, 'a customer cannot delete a unit');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select delete_unit('00000000-0000-0000-0000-0000000000f1')$$, 'a unit with users cannot be deleted');
select move_user('10000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000c1');
select tst.fails($$select delete_unit('00000000-0000-0000-0000-0000000000f1')$$, 'a unit an event uses cannot be deleted');

-- Once archiving removed its events, the admin deletes the company.
reset role;
delete from events where id = '30000000-0000-0000-0000-0000000000f1';
set role authenticated;
select delete_unit('00000000-0000-0000-0000-0000000000f1');
select tst.ok(not exists (select 1 from units where id = '00000000-0000-0000-0000-0000000000f1'), 'the admin deletes the company');

-- A supplier goes with its catalog. An admin working in it returns to admin.
select tst.act('10000000-0000-0000-0000-000000000042');
select act_as_unit('00000000-0000-0000-0000-0000000000f2');
select tst.act('10000000-0000-0000-0000-000000000001');
select delete_unit('00000000-0000-0000-0000-0000000000f2');
select tst.ok(not exists (select 1 from units where id = '00000000-0000-0000-0000-0000000000f2'), 'the admin deletes the supplier');
select tst.ok(not exists (select 1 from items where id = '20000000-0000-0000-0000-0000000000f2'), 'its catalog goes with it');
select tst.ok((select acting_unit_id from users where id = '10000000-0000-0000-0000-000000000042') is null,
  'an admin working in it returns to admin');

-- Leave the shared fixtures as the later test files expect them.
reset role;
delete from auth.users where id in ('10000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000042');
