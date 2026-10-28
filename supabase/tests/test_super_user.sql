-- Super users: admins mark them; they approve sign-ups to their own unit
-- and remove users from it, and nothing beyond it.
set client_min_messages = warning;

insert into units (id, name, kind) values
  ('00000000-0000-0000-0000-0000000000d1', 'פלוגה ד', 'company'),
  ('00000000-0000-0000-0000-0000000000d2', 'נשקייה', 'supplier'),
  ('00000000-0000-0000-0000-0000000000d3', 'רנגלר', 'supplier');
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000021', 'sergeant@x.il'),
  ('10000000-0000-0000-0000-000000000022', 'recruit@x.il'),
  ('10000000-0000-0000-0000-000000000023', 'stranger@x.il'),
  ('10000000-0000-0000-0000-000000000024', 'other-company@x.il'),
  ('10000000-0000-0000-0000-000000000025', 'armorer@x.il'),
  ('10000000-0000-0000-0000-000000000026', 'two-units@x.il'),
  ('10000000-0000-0000-0000-000000000027', 'armory-new@x.il'),
  ('10000000-0000-0000-0000-000000000028', 'leaving@x.il'),
  ('10000000-0000-0000-0000-000000000029', 'late@x.il');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000021');
select register_profile('גיל', 'שר', '1234590', 'customer', '00000000-0000-0000-0000-0000000000d1');
select tst.act('10000000-0000-0000-0000-000000000022');
select register_profile('טל', 'אור', '1234591', 'customer', '00000000-0000-0000-0000-0000000000d1');
select tst.act('10000000-0000-0000-0000-000000000023');
select register_profile('רז', 'בן', '1234592', 'customer', '00000000-0000-0000-0000-0000000000d1');
select tst.act('10000000-0000-0000-0000-000000000024');
select register_profile('שי', 'דן', '1234593', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000025');
select register_profile('עדי', 'רון', '1234594', 'supplier', '00000000-0000-0000-0000-0000000000d2');
select tst.act('10000000-0000-0000-0000-000000000026');
select register_profile('נוי', 'חן', '1234595', 'supplier', '00000000-0000-0000-0000-0000000000d2',
  array['00000000-0000-0000-0000-0000000000d3']::uuid[]);
select tst.act('10000000-0000-0000-0000-000000000027');
select register_profile('אור', 'גל', '1234596', 'supplier', '00000000-0000-0000-0000-0000000000d2');
select tst.act('10000000-0000-0000-0000-000000000028');
select register_profile('בר', 'לב', '1234597', 'customer', '00000000-0000-0000-0000-0000000000d1');

select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000021');
select approve_user('10000000-0000-0000-0000-000000000025');
select approve_user('10000000-0000-0000-0000-000000000028');

-- Marking ------------------------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000021');
select tst.fails($$select set_super_user('10000000-0000-0000-0000-000000000021', true)$$, 'a customer marks itself');
select tst.ok(not is_super_user(), 'a user starts as a regular user');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000022')$$,
  'a regular customer approves a sign-up to its company');
select tst.ok((select count(*) from users) = 1, 'a regular customer reads only its own profile');

select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select set_super_user('10000000-0000-0000-0000-000000000001', true)$$, 'an admin as a super user');
select tst.fails($$select set_super_user('10000000-0000-0000-0000-000000000022', true)$$, 'a pending user as a super user');
select set_super_user('10000000-0000-0000-0000-000000000021', true);
select set_super_user('10000000-0000-0000-0000-000000000025', true);
select tst.ok(exists (select 1 from access_review() where user_id = '10000000-0000-0000-0000-000000000021'),
  'the access review lists a customer super user');

-- A company's super user -----------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000021');
select tst.ok(is_super_user(), 'a marked customer is a super user');
select tst.ok((select count(*) from users) = 4, 'a super user reads the users of its company, pending ones too');
select tst.ok(not exists (select 1 from users where id = '10000000-0000-0000-0000-000000000024'),
  'and not the users of another company');

select approve_user('10000000-0000-0000-0000-000000000022');
select reject_user('10000000-0000-0000-0000-000000000023', 'לא מוכר');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000024')$$, 'a super user approves another company''s sign-up');
select tst.fails($$select reject_user('10000000-0000-0000-0000-000000000024')$$, 'a super user rejects another company''s sign-up');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000027')$$, 'a company super user approves a supplier');

select remove_from_unit('10000000-0000-0000-0000-000000000028');
select tst.fails($$select remove_from_unit('10000000-0000-0000-0000-000000000021')$$, 'a super user removes itself');
select tst.fails($$select remove_from_unit('10000000-0000-0000-0000-000000000024')$$, 'a super user removes another company''s user');
select tst.fails($$select remove_from_unit('10000000-0000-0000-0000-000000000001')$$, 'a super user removes an admin');
select tst.fails($$select set_user_active('10000000-0000-0000-0000-000000000028', true)$$, 'a super user reactivates a user');
select tst.fails($$select set_super_user('10000000-0000-0000-0000-000000000022', true)$$, 'a super user marks another');
reset role;
select tst.ok((select approval from users where id = '10000000-0000-0000-0000-000000000022') = 'approved', 'the super user approved');
select tst.ok((select approved_by from users where id = '10000000-0000-0000-0000-000000000022') = '10000000-0000-0000-0000-000000000021',
  'and is recorded as the approver');
select tst.ok((select approval from users where id = '10000000-0000-0000-0000-000000000023') = 'rejected', 'the super user rejected');
select tst.ok((select approval from users where id = '10000000-0000-0000-0000-000000000024') = 'pending',
  'another company''s sign-up stays pending');
select tst.ok(not (select active from users where id = '10000000-0000-0000-0000-000000000028'), 'a removed customer is inactive');
set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000022');
select tst.fails($$select remove_from_unit('10000000-0000-0000-0000-000000000021')$$, 'a regular customer removes a user');

-- A supplier's super user ------------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000025');
select approve_user('10000000-0000-0000-0000-000000000027');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000026')$$,
  'a super user approves a sign-up that also picked a unit it does not run');
select tst.ok((select count(*) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000026') = 2,
  'a super user reads all units of a user in its unit');

select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000026');
select tst.act('10000000-0000-0000-0000-000000000025');
select remove_from_unit('10000000-0000-0000-0000-000000000026');
reset role;
select tst.ok((select active from users where id = '10000000-0000-0000-0000-000000000026'),
  'a supplier removed from one unit stays active');
select tst.ok((select array_agg(supplier_id) from user_suppliers where user_id = '10000000-0000-0000-0000-000000000026')
  = array['00000000-0000-0000-0000-0000000000d3']::uuid[], 'and keeps only its other unit');
select tst.ok((select unit_id from users where id = '10000000-0000-0000-0000-000000000026') = '00000000-0000-0000-0000-0000000000d3',
  'which becomes its main unit');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000025');
select tst.ok(not exists (select 1 from users where id = '10000000-0000-0000-0000-000000000026'),
  'a user who left the unit is out of the super user''s sight');

-- Losing the flag ---------------------------------------------------------------------------
select tst.act('10000000-0000-0000-0000-000000000001');
select move_user('10000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-0000000000d3');
select set_super_user('10000000-0000-0000-0000-000000000021', false);
reset role;
select tst.ok(not (select super_user from users where id = '10000000-0000-0000-0000-000000000025'),
  'moving to another unit drops the flag');
set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000029');
select register_profile('דור', 'זך', '1234598', 'customer', '00000000-0000-0000-0000-0000000000d1');
select tst.act('10000000-0000-0000-0000-000000000021');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000029')$$, 'an unmarked super user approves');
select tst.ok((select count(*) from users) = 1, 'an unmarked super user reads only its own profile');
reset role;
