-- An admin works as a unit's user: a customer of a company or a supplier
-- of a supplier unit, with exactly that user's rights, and returns to admin.
set client_min_messages = warning;

insert into units (id, name, kind) values
  ('00000000-0000-0000-0000-0000000000e1', 'פלוגה ה', 'company'),
  ('00000000-0000-0000-0000-0000000000e2', 'שק״ם', 'supplier'),
  ('00000000-0000-0000-0000-0000000000e3', 'פלוגה ו', 'company');
update units set active = false where id = '00000000-0000-0000-0000-0000000000e3';
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000041', 'e-company@x.il'),
  ('10000000-0000-0000-0000-000000000042', 'e-waiting@x.il');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000041');
select register_profile('דור', 'שם', '1234601', 'customer', '00000000-0000-0000-0000-0000000000e1');
select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000041');
select tst.act('10000000-0000-0000-0000-000000000042');
select register_profile('עוז', 'כץ', '1234602', 'customer', '00000000-0000-0000-0000-0000000000e1');

-- Only an admin works as a unit's user -----------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000041');
select tst.fails($$select act_as_unit('00000000-0000-0000-0000-0000000000e2')$$, 'a customer works as a supplier');
select tst.fails($$select return_to_admin()$$, 'a customer returns to admin');
reset role;
select tst.fails($$update users set acting_unit_id = '00000000-0000-0000-0000-0000000000e2'
  where id = '10000000-0000-0000-0000-000000000041'$$, 'a customer row with a unit to act in');
set role authenticated;

-- As a company's customer ------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select act_as_unit('00000000-0000-0000-0000-0000000000e3')$$, 'an admin works in an inactive unit');
select tst.fails($$select act_as_unit(gen_random_uuid())$$, 'an admin works in a unit that does not exist');
select act_as_unit('00000000-0000-0000-0000-0000000000c1');
select tst.ok(my_role() = 'customer' and my_unit() = '00000000-0000-0000-0000-0000000000c1',
  'an admin in a company is its customer');
select tst.ok(not is_admin(), 'an admin working in a unit has no admin rights');
select tst.ok((select count(*) from users) = 1, 'and reads only its own profile');
select tst.ok(exists (select 1 from requests) and not exists (
  select 1 from requests where company_id <> '00000000-0000-0000-0000-0000000000c1'), 'and only its company''s requests');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000042')$$, 'an admin working in a unit approves a sign-up');

-- Switching straight to a supplier unit ----------------------------------------------
select act_as_unit('00000000-0000-0000-0000-0000000000a1');
select tst.ok(my_role() = 'supplier' and my_unit() = '00000000-0000-0000-0000-0000000000a1',
  'an admin in a supplier unit is its supplier');
select tst.ok(array(select my_suppliers()) = array['00000000-0000-0000-0000-0000000000a1'::uuid],
  'and works in that one supplier unit');
select tst.ok(not exists (select 1 from requests where supplier_id <> '00000000-0000-0000-0000-0000000000a1'),
  'and reads only its requests');

-- Returning --------------------------------------------------------------------------
select return_to_admin();
select tst.ok(my_role() = 'admin' and my_unit() is null and is_admin(), 'an admin returns to admin');
select tst.ok(not exists (select my_suppliers()), 'with no supplier unit');
select approve_user('10000000-0000-0000-0000-000000000042');

-- A unit deactivated while an admin works in it returns them to admin.
select act_as_unit('00000000-0000-0000-0000-0000000000e2');
reset role;
update units set active = false where id = '00000000-0000-0000-0000-0000000000e2';
set role authenticated;
select tst.ok(is_admin() and not exists (select my_suppliers()), 'a deactivated unit returns the admin to admin');
select return_to_admin();
reset role;
