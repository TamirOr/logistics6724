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

-- Every function anon or authenticated can run is on purpose, every table
-- has RLS, anon holds no grants, every view is security_invoker. The same
-- check runs against the live projects from the health workflow.
select tst.ok(not exists (select 1 from privilege_drift()),
  'privilege drift: ' || coalesce((select string_agg(d, '; ') from privilege_drift() d), ''));
-- The check itself catches what it should.
create function public.drift_probe() returns void language sql as 'select';
grant execute on function public.drift_probe to authenticated;
create table public.drift_table (id int);
grant select on public.drift_table to anon;
select tst.ok((select count(*) from privilege_drift() d
  where d in ('authenticated can execute drift_probe()', 'no row-level security on drift_table',
              'anon has a grant on drift_table')) = 3,
  'privilege_drift reports a stray grant, a table without RLS and an anon grant');
drop function public.drift_probe();
drop table public.drift_table;
set role authenticated;
select tst.denied($$select * from privilege_drift()$$, 'authenticated runs privilege_drift()');
reset role;

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

-- Admin rights come with the email-code sign-in; no second factor --------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(is_admin(), 'an admin signed in with the email code is an admin');
select tst.ok((select count(*) from users) > 1, 'an admin reads all profiles');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(not is_admin(), 'a customer is not an admin');

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
select tst.ok(config('max_new_items_per_company_day') = '100', 'a company may add 100 new items a day by default');
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
update app_config set value = '100' where key = 'max_new_items_per_company_day';

-- F8: a creator who lost access cannot close or cancel ------------------------
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f2', 'leaver@x.il');
set role authenticated;
select tst.act('10000000-0000-0000-0000-0000000000f2');
select register_profile('עוזב', 'לוי', '1234600', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000001');
select approve_user('10000000-0000-0000-0000-0000000000f2');
select tst.act('10000000-0000-0000-0000-0000000000f2');
insert into tst.t select 'leaver_event', create_event('אירוע של עוזב', 'company');
select tst.act('10000000-0000-0000-0000-000000000001');
select set_user_active('10000000-0000-0000-0000-0000000000f2', false);
select tst.act('10000000-0000-0000-0000-0000000000f2');
select tst.fails($$select cancel_event((select v from tst.t where k = 'leaver_event'))$$, 'a deactivated creator cancels');
select tst.fails($$select close_event((select v from tst.t where k = 'leaver_event'))$$, 'a deactivated creator closes');
select tst.act('10000000-0000-0000-0000-000000000001');
select set_user_active('10000000-0000-0000-0000-0000000000f2', true);
select move_user('10000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2');
select tst.act('10000000-0000-0000-0000-0000000000f2');
select tst.fails($$select cancel_event((select v from tst.t where k = 'leaver_event'))$$, 'a moved creator cancels');
select tst.fails($$select close_event((select v from tst.t where k = 'leaver_event'))$$, 'a moved creator closes');
select tst.act('10000000-0000-0000-0000-000000000001');
select move_user('10000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-0000000000f2');
select cancel_event((select v from tst.t where k = 'leaver_event'));
reset role;
select tst.ok((select status from events where id = (select v from tst.t where k = 'leaver_event')) = 'cancelled',
  'a creator still in the unit cancels');

-- F9: push endpoints must be a browser push service ------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select register_push_subscription('http://evil.example/x', 'k', 'a')$$, 'an arbitrary endpoint');
select tst.fails($$select register_push_subscription('http://fcm.googleapis.com/fcm/send/x', 'k', 'a')$$, 'plain http');
select tst.fails($$select register_push_subscription('https://fcm.googleapis.com.evil.example/x', 'k', 'a')$$,
  'a look-alike host');
select tst.fails($$insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('10000000-0000-0000-0000-000000000002', 'https://169.254.169.254/latest', 'k', 'a')$$,
  'a direct insert of an arbitrary endpoint');
select register_push_subscription('https://fcm.googleapis.com/fcm/send/ok', 'k', 'a');
select register_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/ok', 'k', 'a');
select register_push_subscription('https://web.push.apple.com/ok', 'k', 'a');
select register_push_subscription('https://wns2-par02p.notify.windows.com/w/?token=ok', 'k', 'a');
select tst.ok((select count(*) from push_subscriptions) = 4, 'the four browser push services are accepted');
reset role;
delete from push_subscriptions;
