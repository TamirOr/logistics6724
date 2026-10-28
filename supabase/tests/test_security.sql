-- Function privileges: anon and authenticated may call only what the app
-- needs. Server-only helpers and secrets stay out of reach.
set client_min_messages = warning;

create function tst.denied(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege then return; end;
  raise exception 'FAILED (should be denied): %', what;
end $$;
grant execute on function tst.denied to anon, authenticated;

select tst.ok(length((select value from app_config where key = 'cron_secret')) = 64, 'migration generates a 64-character cron secret');
update app_config set value = 's3cr3t' where key = 'cron_secret';
insert into app_config (key, value) values ('functions_url', 'https://x/functions/v1'), ('vapid_private_key', 'priv');
insert into app_config (key, value, client_readable) values ('vapid_public_key', 'pub', true);

set role anon;
select tst.denied($$select config('cron_secret')$$, 'anon reads cron secret through config()');
select tst.denied($$select * from server_configs(array['cron_secret'])$$, 'anon calls server_configs()');
select tst.denied($$select item_names(array[]::uuid[])$$, 'anon calls item_names()');
select tst.denied($$select drop_empty_missing_queues()$$, 'anon calls drop_empty_missing_queues()');
select tst.denied($$select search_items(gen_random_uuid(), 'x')$$, 'anon calls search_items()');
select tst.ok((health() ->> 'ok')::boolean, 'anon health probe still works');
select tst.denied($$select health_report()$$, 'anon calls health_report()');
select tst.denied($$select ops_metrics()$$, 'anon calls ops_metrics()');
reset role;

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(config('cron_secret') is null, 'config() hides the cron secret');
select tst.ok(config('functions_url') is null, 'config() hides the functions url');
select tst.ok(config('did_you_mean_threshold') = '0.4', 'config() returns tuning keys');
select tst.ok(config('vapid_public_key') = 'pub', 'config() returns the VAPID public key');
select tst.ok(config('vapid_private_key') is null, 'config() hides the VAPID private key');
select tst.denied($$select * from server_configs(array['cron_secret'])$$, 'authenticated calls server_configs()');
select tst.denied($$select flush_missing_queue()$$, 'authenticated calls flush_missing_queue()');
select tst.denied($$select claim_outbox(1)$$, 'authenticated calls claim_outbox()');
select tst.denied($$select notify('x', 'y')$$, 'authenticated calls notify()');
select tst.denied($$select item_names(array[]::uuid[])$$, 'authenticated calls item_names()');
select tst.denied($$select health_report()$$, 'authenticated calls health_report()');
select tst.denied($$select ops_metrics()$$, 'authenticated calls ops_metrics()');
select tst.denied($$select purge_expired()$$, 'authenticated calls purge_expired()');
reset role;

set role service_role;
select tst.ok((select value from server_configs(array['cron_secret'])) = 's3cr3t', 'service role reads server config');
reset role;

-- Every function anon or authenticated can run is on purpose.
select tst.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('health')
), 'anon can execute only health');

-- Outbox lifecycle ---------------------------------------------------------------
truncate notification_outbox;
select notify('approved', 'one', p_user => '10000000-0000-0000-0000-000000000002');
select tst.ok((select count(*) from claim_outbox(10)) = 1, 'claim takes the row');
select tst.ok((select count(*) from claim_outbox(10)) = 0, 'a claimed row is not claimed twice');
update notification_outbox set claimed_at = now() - interval '6 minutes';
select tst.ok((select count(*) from claim_outbox(10)) = 1, 'an expired lease is claimed again');
select release_outbox(id, 'boom') from notification_outbox;
select tst.ok((select count(*) from claim_outbox(10)) = 1, 'a released row is claimed again');
select mark_outbox_sent(id) from notification_outbox;
select tst.ok((select count(*) from claim_outbox(10)) = 0, 'a sent row is never claimed');
select notify('approved', 'two', p_user => '10000000-0000-0000-0000-000000000002');
update notification_outbox set attempts = 5, created_at = now() - interval '2 days' where body = 'two';
select tst.ok((select count(*) from claim_outbox(10)) = 0, 'a row with 5 attempts is abandoned');
update notification_outbox set created_at = now() - interval '8 days' where body = 'one';
select tst.ok((purge_expired() ->> 'outbox')::int = 0, 'sent and abandoned rows are kept 14 days');
update notification_outbox set created_at = now() - interval '15 days';
select tst.ok((purge_expired() ->> 'outbox')::int = 2, 'purge removes sent and abandoned rows after 14 days');

set role authenticated;
select tst.denied($$select * from server_configs(array['cron_secret'])$$, 'authenticated reads server configs');
reset role;
set role service_role;
select tst.ok((select count(*) from server_configs(array['cron_secret', 'functions_url'])) = 2, 'service role reads several configs');
reset role;

-- F2: admin rights need a second factor (aal2) -------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001', 'aal1');
select tst.ok(not is_admin(), 'an admin with only the email code is not an admin');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000006')$$, 'aal1 admin approves a user');
select tst.ok((select count(*) from users) = 1, 'aal1 admin reads only their own profile');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(is_admin(), 'an admin with aal2 is an admin');
select tst.ok((select count(*) from users) > 1, 'aal2 admin reads all profiles');

-- F4: the unit roster needs approval or the join code --------------------------
reset role;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f1', 'stranger@x.il');
update app_config set value = '1234567890' where key = 'join_code';
set role authenticated;
select tst.act('10000000-0000-0000-0000-0000000000f1');
select tst.ok((select count(*) from units) = 0, 'a stranger sees no units');
select tst.fails($$select * from signup_units('0000000000')$$, 'a wrong join code lists units');
select tst.fails($$select * from signup_units(null)$$, 'no join code lists units');
-- Spaces around a pasted code do not matter.
create temp table tst_signup as select * from signup_units(' 1234567890 ');
reset role;
select tst.ok((select count(*) from tst_signup) = (select count(*) from units where active)
  and (select count(*) from tst_signup) > 0, 'the right join code lists every active unit');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select count(*) from units) > 0, 'an approved user sees units');
select tst.fails($$select join_code()$$, 'a customer reads the join code');
select tst.fails($$select rotate_join_code()$$, 'a customer rotates the join code');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.act('10000000-0000-0000-0000-000000000001', 'aal1');
select tst.fails($$select join_code()$$, 'an admin without the second factor reads the join code');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(join_code() = '1234567890', 'an admin reads the join code');
select tst.ok(rotate_join_code() ~ '^[0-9]{10}$', 'rotation returns a new ten-digit code');
select tst.ok(join_code() <> '1234567890', 'rotation replaces the code');
select tst.act('10000000-0000-0000-0000-0000000000f1');
select tst.fails($$select * from signup_units('1234567890')$$, 'the old join code stops working');
reset role;

-- F7: size limits ---------------------------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-0000000000f1');
select tst.fails(format($$select register_profile(%L, 'ב', '1234599', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  repeat('א', 51)), 'a 51-character first name');
select tst.fails(format($$select register_profile('א', %L, '1234599', 'customer', '00000000-0000-0000-0000-0000000000c1')$$,
  repeat('א', 10000)), 'a 10 KB last name');
select register_profile(repeat('א', 50), 'ב', '1234599', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.fails(format($$select register_push_subscription('https://fcm.googleapis.com/fcm/send/x', 'k', 'a', %L)$$,
  repeat('x', 10000)), 'a 10 KB user agent');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails(format($$select add_item('00000000-0000-0000-0000-0000000000a1', %L)$$, repeat('x', 101)),
  'a 101-character item name');
select tst.fails(format($$insert into item_aliases (item_id, alias)
  select id, %L from items where supplier_id = '00000000-0000-0000-0000-0000000000a1' limit 1$$, repeat('x', 101)),
  'a 101-character alias');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails(format($$select create_event(%L, 'company')$$, repeat('x', 81)), 'an 81-character event name');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails(format($$insert into units (name, kind) values (%L, 'company')$$, repeat('x', 51)),
  'a 51-character unit name');
select tst.fails(format($$select reject_user('10000000-0000-0000-0000-0000000000f1', %L)$$, repeat('x', 501)),
  'a 501-character rejection reason');
reset role;

-- A company adds at most max_new_items_per_company_day unverified items a day.
update app_config set value = '2' where key = 'max_new_items_per_company_day';
delete from items where not verified and created_by in (
  select id from users where unit_id = '00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select add_item('00000000-0000-0000-0000-0000000000a1', 'פריט מכסה 1');
select add_item('00000000-0000-0000-0000-0000000000a1', 'פריט מכסה 2');
select tst.fails($$select add_item('00000000-0000-0000-0000-0000000000a1', 'פריט מכסה 3')$$,
  'a third new item in a day over a cap of 2');
select tst.ok(add_item('00000000-0000-0000-0000-0000000000a1', 'פריט מכסה 1') is not null,
  'an existing item still resolves at the cap');
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.ok(add_item('00000000-0000-0000-0000-0000000000a1', 'פריט מכסה 3') is not null,
  'another company has its own cap');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok(add_item('00000000-0000-0000-0000-0000000000a1', 'פריט מכסה 4') is not null,
  'suppliers are not capped in their own catalog');
reset role;
update app_config set value = '30' where key = 'max_new_items_per_company_day';
