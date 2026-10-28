-- A supplier user in several supplier units: sign-up, what they see and
-- change, and how a move or a new side resets their units.
set client_min_messages = warning;

insert into units (id, name, kind) values
  ('00000000-0000-0000-0000-0000000000b1', 'מטבח שדה', 'supplier'),
  ('00000000-0000-0000-0000-0000000000b2', 'סגירות', 'supplier'),
  ('00000000-0000-0000-0000-0000000000b3', 'שלישות', 'supplier');
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000011', 'multi@x.il'),
  ('10000000-0000-0000-0000-000000000012', 'other@x.il');

-- Sign-up ----------------------------------------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000011');
select tst.fails($$select register_profile('א', 'ב', '1234580', 'supplier', '00000000-0000-0000-0000-0000000000b1',
  array['00000000-0000-0000-0000-0000000000c1']::uuid[])$$, 'a supplier cannot add a company to its units');
select tst.fails($$select register_profile('א', 'ב', '1234580', 'customer', '00000000-0000-0000-0000-0000000000c1',
  array['00000000-0000-0000-0000-0000000000c2']::uuid[])$$, 'a customer cannot pick two companies');
reset role;
update units set active = false where id = '00000000-0000-0000-0000-0000000000b3';
set role authenticated;
select tst.fails($$select register_profile('א', 'ב', '1234580', 'supplier', '00000000-0000-0000-0000-0000000000b1',
  array['00000000-0000-0000-0000-0000000000b3']::uuid[])$$, 'a supplier cannot pick an inactive unit');
reset role;
update units set active = true where id = '00000000-0000-0000-0000-0000000000b3';
set role authenticated;
select tst.ok((select count(*) from users where id = '10000000-0000-0000-0000-000000000011') = 0, 'a refused sign-up leaves no profile');

select register_profile('יעל', 'גל', '1234580', 'supplier', '00000000-0000-0000-0000-0000000000b1',
  array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2']::uuid[]);
select tst.ok((select unit_id from users where id = '10000000-0000-0000-0000-000000000011') = '00000000-0000-0000-0000-0000000000b1',
  'the first unit picked is the user unit');
select tst.ok((select count(*) from user_suppliers) = 2, 'a supplier reads its own two units');
select tst.ok(not exists (select my_suppliers()), 'a pending supplier has no units to work in');
select tst.fails($$insert into user_suppliers values ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000b3')$$,
  'a supplier adds itself to a unit');

select tst.act('10000000-0000-0000-0000-000000000012');
select register_profile('עמית', 'רז', '1234581', 'supplier', '00000000-0000-0000-0000-0000000000b3');
select tst.ok((select count(*) from user_suppliers) = 1, 'a user does not read another user''s units');

select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000011');
select approve_user('10000000-0000-0000-0000-000000000012');
select tst.ok((select count(*) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000011') = 2,
  'an admin reads every user''s units');

-- Work across units --------------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'multi_ev', create_event('אימון משולב', 'company', null, '2026-11-10');
insert into tst.t select 'multi_list', id from lists where event_id = (select v from tst.t where k = 'multi_ev');
insert into requests (id, list_id, item_id, quantity) values
  ('20000000-0000-0000-0000-0000000000b1', (select v from tst.t where k = 'multi_list'),
   add_item('00000000-0000-0000-0000-0000000000b1', 'מחבת'), 2),
  ('20000000-0000-0000-0000-0000000000b2', (select v from tst.t where k = 'multi_list'),
   add_item('00000000-0000-0000-0000-0000000000b2', 'אוהל'), 3),
  ('20000000-0000-0000-0000-0000000000b3', (select v from tst.t where k = 'multi_list'),
   add_item('00000000-0000-0000-0000-0000000000b3', 'טופס'), 1);

select tst.act('10000000-0000-0000-0000-000000000011');
select tst.ok((select count(*) from my_suppliers()) = 2, 'an approved supplier works in both units');
select tst.ok((select count(*) from requests) = 2, 'a supplier sees the requests of both its units');
select tst.ok(not exists (select 1 from requests where supplier_id = '00000000-0000-0000-0000-0000000000b3'),
  'and not those of a third unit');
select tst.ok((select count(*) from events where id = (select v from tst.t where k = 'multi_ev')) = 1, 'a supplier sees the event');
update requests set status = 'ready' where id in ('20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b2');
update requests set status = 'ready' where id = '20000000-0000-0000-0000-0000000000b3';
reset role;
select tst.ok((select count(*) from requests where status = 'ready' and id in (
  '20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b2')) = 2, 'a supplier marks ready in both units');
select tst.ok((select status from requests where id = '20000000-0000-0000-0000-0000000000b3') = 'pending',
  'a supplier cannot mark ready in a third unit');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000011');
select add_item('00000000-0000-0000-0000-0000000000b2', 'שק שינה');
select tst.ok((select verified from items where name = 'שק שינה'), 'a supplier adds a verified item to its second unit');
select tst.fails($$select add_item('00000000-0000-0000-0000-0000000000b3', 'עט')$$, 'a supplier adds to a third unit');
update items set verified = true where name in ('אוהל', 'טופס');
reset role;
select tst.ok((select verified from items where name = 'אוהל'), 'a supplier verifies items of its second unit');
select tst.ok(not (select verified from items where name = 'טופס'), 'a supplier cannot verify items of a third unit');

-- Moves and a new side reset the units ---------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select move_user('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000b3');
select tst.ok((select array_agg(supplier_id) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000011')
  = array['00000000-0000-0000-0000-0000000000b3']::uuid[], 'a move leaves the user in only the new unit');
select move_user('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000c1');
select tst.ok(not exists (select 1 from user_suppliers where user_id = '10000000-0000-0000-0000-000000000011'),
  'a user moved to a company leaves every supplier unit');
reset role;

-- A rejected supplier who signs up again as a customer leaves its units.
update users set approval = 'rejected' where id = '10000000-0000-0000-0000-000000000012';
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000012');
select register_profile('עמית', 'רז', '1234581', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.ok((select count(*) from user_suppliers) = 0, 'a supplier who signs up again as a customer leaves its units');
reset role;

-- Admins edit an approved supplier's units -----------------------------------------
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000013', 'edit@x.il');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000013');
select register_profile('גיל', 'שם', '1234582', 'supplier', '00000000-0000-0000-0000-0000000000b1', null);
select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000013');

select set_user_suppliers('10000000-0000-0000-0000-000000000013',
  array['00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1']::uuid[]);
select tst.ok((select count(*) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000013') = 2,
  'an admin adds a unit to a supplier');
select tst.ok((select unit_id from users where id = '10000000-0000-0000-0000-000000000013') = '00000000-0000-0000-0000-0000000000b1',
  'the main unit stays while the supplier is still in it');

select set_user_suppliers('10000000-0000-0000-0000-000000000013', array['00000000-0000-0000-0000-0000000000b3']::uuid[]);
select tst.ok((select array_agg(supplier_id) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000013')
  = array['00000000-0000-0000-0000-0000000000b3']::uuid[], 'an admin replaces a supplier''s units');
select tst.ok((select unit_id from users where id = '10000000-0000-0000-0000-000000000013') = '00000000-0000-0000-0000-0000000000b3',
  'a supplier who left its main unit gets the first new one');

select tst.fails($$select set_user_suppliers('10000000-0000-0000-0000-000000000013', array[]::uuid[])$$,
  'a supplier left with no unit');
select tst.fails($$select set_user_suppliers('10000000-0000-0000-0000-000000000013',
  array['00000000-0000-0000-0000-0000000000c1']::uuid[])$$, 'a company as a supplier unit');
select tst.fails($$select set_user_suppliers('10000000-0000-0000-0000-000000000002',
  array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'supplier units for a customer');
reset role;
update units set active = false where id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3');
set role authenticated;
select tst.fails($$select set_user_suppliers('10000000-0000-0000-0000-000000000013',
  array['00000000-0000-0000-0000-0000000000b2']::uuid[])$$, 'adding an inactive unit');
select set_user_suppliers('10000000-0000-0000-0000-000000000013',
  array['00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1']::uuid[]);
select tst.ok((select count(*) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000013') = 2,
  'a supplier keeps a unit that was deactivated');

select tst.act('10000000-0000-0000-0000-000000000013');
select tst.fails($$select set_user_suppliers('10000000-0000-0000-0000-000000000013',
  array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2']::uuid[])$$,
  'a supplier edits its own units');
reset role;
update units set active = true where id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3');
