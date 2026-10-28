-- Deleting a user: only an admin, never themselves or another admin. Runs
-- after test_flows.sql and uses its users: 01 is the admin, 02 a customer.
set client_min_messages = warning;

insert into units (id, name, kind) values ('00000000-0000-0000-0000-0000000000f3', 'פלוגה שנדחתה', 'company');
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000051', 'deleted@x.il'),
  ('10000000-0000-0000-0000-000000000052', 'other-admin@x.il'),
  ('10000000-0000-0000-0000-000000000053', 'approved-by-deleted@x.il'),
  ('10000000-0000-0000-0000-000000000054', 'rejected@x.il');
select promote_admin('other-admin@x.il');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000051');
select register_profile('נועה', 'בר', '1234601', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000053');
select register_profile('עדי', 'גל', '1234602', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000054');
select register_profile('שי', 'דור', '1234603', 'customer', '00000000-0000-0000-0000-0000000000f3');
select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-000000000051');
select reject_user('10000000-0000-0000-0000-000000000054');
reset role;
update users set approval = 'approved', approved_by = '10000000-0000-0000-0000-000000000051'
where id = '10000000-0000-0000-0000-000000000053';
set role authenticated;

-- Should fail: a non-admin deletes, an admin deletes themselves or another admin.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select delete_user('10000000-0000-0000-0000-000000000051')$$, 'a customer cannot delete a user');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select delete_user('10000000-0000-0000-0000-000000000001')$$, 'an admin cannot delete themselves');
select tst.fails($$select delete_user('10000000-0000-0000-0000-000000000052')$$, 'an admin cannot delete another admin');

-- The admin deletes a user, even one who approved others.
select delete_user('10000000-0000-0000-0000-000000000051');
select tst.ok(not exists (select 1 from users where id = '10000000-0000-0000-0000-000000000051'), 'the admin deletes the user');
select tst.ok((select approved_by from users where id = '10000000-0000-0000-0000-000000000053') is null,
  'users they approved stay, without the approver');

-- Signing in again starts a new sign-up.
select tst.act('10000000-0000-0000-0000-000000000051');
select register_profile('נועה', 'בר', '1234601', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.ok((select approval from users where id = '10000000-0000-0000-0000-000000000051') = 'pending',
  'a deleted user signs up again and waits for approval');

-- A rejected sign-up goes with its unit instead of blocking it.
select tst.act('10000000-0000-0000-0000-000000000001');
select delete_unit('00000000-0000-0000-0000-0000000000f3');
select tst.ok(not exists (select 1 from users where id = '10000000-0000-0000-0000-000000000054'),
  'a rejected sign-up goes with its unit');

-- Leave the shared fixtures as the later test files expect them.
reset role;
delete from auth.users where id in ('10000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000052',
  '10000000-0000-0000-0000-000000000053', '10000000-0000-0000-0000-000000000054');
