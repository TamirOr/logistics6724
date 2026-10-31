-- Admins create users: at once for an email that signed in before, as an
-- invite claimed by the first sign-in otherwise. Runs after test_flows.sql
-- and uses its users and units: 01 is the admin, 02 a customer, c1 a
-- company, a1 and a2 suppliers.
set client_min_messages = warning;

insert into units (id, name, kind) values
  ('00000000-0000-0000-0000-0000000000f4', 'פלוגה למחיקה', 'company');
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000061', 'signed-in@x.il');

set role authenticated;

-- Should fail: anyone but an admin, a unit off the side, bad details, an email that has a user.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select create_user('a@x.il', 'א', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  'a customer cannot create a user');
select tst.ok((select count(*) from user_invites) = 0, 'nothing was invited');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select create_user('a@x.il', 'א', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000a1')$$,
  'a customer cannot be put in a supplier unit');
select tst.fails($$select create_user('a@x.il', 'א', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000c1',
  '{00000000-0000-0000-0000-0000000000c2}')$$, 'a customer belongs to one company');
select tst.fails($$select create_user('a@x.il', 'א', 'ב', '1234701', 'admin', null)$$, 'an admin cannot be created here');
select tst.fails($$select create_user('not an email', 'א', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  'the email must be an email');
select tst.fails($$select create_user('a@x.il', 'א', 'ב', '12', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  'the service number must be 5 to 9 digits');
select tst.fails($$select create_user('a@x.il', ' ', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  'the first name is required');
select tst.fails($$select create_user(' CUST1@x.il', 'א', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  'an email that already has a user');
reset role;
set role anon;
select tst.fails($$select create_user('a@x.il', 'א', 'ב', '1234701', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  'anon cannot create a user');
reset role;
set role authenticated;

-- An email that signed in before gets its approved profile at once.
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(create_user('Signed-In@x.il', 'יעל', 'שחר', '1234702', 'customer', '00000000-0000-0000-0000-0000000000c1') = 'created',
  'an email with a sign-in is created at once');
select tst.ok((select approval = 'approved' and approved_by = '10000000-0000-0000-0000-000000000001' and unit_id = '00000000-0000-0000-0000-0000000000c1'
               from users where id = '10000000-0000-0000-0000-000000000061'), 'the profile is approved by the admin, in the company');
select tst.act('10000000-0000-0000-0000-000000000061');
select tst.ok(my_unit() = '00000000-0000-0000-0000-0000000000c1', 'the created customer works in their company');

-- Any other email waits as an invite; sending it again replaces its details.
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(create_user('invited@x.il', 'טעות', 'כתיב', '1234703', 'customer', '00000000-0000-0000-0000-0000000000c1') = 'invited',
  'an email without a sign-in is invited');
select create_user(' Invited@X.il ', 'עומר', 'לב', '1234703', 'supplier', '00000000-0000-0000-0000-0000000000a1',
  '{00000000-0000-0000-0000-0000000000a1,00000000-0000-0000-0000-0000000000a2}');
select tst.ok((select count(*) from user_invites) = 1, 'one invite per email');
select tst.ok((select first_name = 'עומר' and role = 'supplier' and cardinality(supplier_ids) = 2 from user_invites
               where email = 'invited@x.il'), 'inviting again replaces the details');

-- Only admins see and cancel invites.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select count(*) from user_invites) = 0, 'a customer sees no invites');
delete from user_invites;
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok((select count(*) from user_invites) = 1, 'a customer cannot cancel an invite');

-- The first sign-in claims the invite: approved, in every supplier unit.
reset role;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000062', 'invited@x.il');
set role authenticated;
select tst.ok((select approval = 'approved' and role = 'supplier' and unit_id = '00000000-0000-0000-0000-0000000000a1'
               and approved_by = '10000000-0000-0000-0000-000000000001'
               from users where id = '10000000-0000-0000-0000-000000000062'), 'the first sign-in claims the invite');
select tst.ok(not exists (select 1 from user_invites where email = 'invited@x.il'), 'a claimed invite is gone');
select tst.act('10000000-0000-0000-0000-000000000062');
select tst.ok((select count(*) from my_suppliers()) = 2, 'the invited supplier works in every supplier unit');

-- An admin cancels an invite.
select tst.act('10000000-0000-0000-0000-000000000001');
select create_user('cancelled@x.il', 'דן', 'רז', '1234704', 'customer', '00000000-0000-0000-0000-0000000000c1');
delete from user_invites where email = 'cancelled@x.il';
select tst.ok(not exists (select 1 from user_invites where email = 'cancelled@x.il'), 'an admin cancels an invite');

-- An invite goes with its unit instead of blocking it.
select create_user('gone@x.il', 'גל', 'אור', '1234705', 'customer', '00000000-0000-0000-0000-0000000000f4');
select delete_unit('00000000-0000-0000-0000-0000000000f4');
select tst.ok(not exists (select 1 from user_invites where email = 'gone@x.il'), 'an invite goes with its unit');

-- An invite that cannot become a profile does not block the sign-in. The
-- rules keep invites valid, so the test breaks one by hand.
select create_user('stuck@x.il', 'רן', 'טל', '1234706', 'customer', '00000000-0000-0000-0000-0000000000c1');
reset role;
update user_invites set role = 'supplier' where email = 'stuck@x.il';
set client_min_messages = error;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000063', 'stuck@x.il');
set client_min_messages = warning;
select tst.ok(exists (select 1 from auth.users where id = '10000000-0000-0000-0000-000000000063'), 'the sign-in goes through');
select tst.ok(not exists (select 1 from users where id = '10000000-0000-0000-0000-000000000063')
              and exists (select 1 from user_invites where email = 'stuck@x.il'), 'the invite stays for the admin to fix');

-- Leave the shared fixtures as the later test files expect them.
delete from user_invites;
delete from auth.users where id in ('10000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000062',
  '10000000-0000-0000-0000-000000000063');
