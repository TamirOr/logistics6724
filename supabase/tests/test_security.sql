-- Function privileges: anon and authenticated may call only what the app
-- needs. Server-only helpers and secrets stay out of reach.
set client_min_messages = warning;

create function tst.denied(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege then return; end;
  raise exception 'FAILED (should be denied): %', what;
end $$;
grant execute on function tst.denied to anon, authenticated;

insert into app_config (key, value) values ('cron_secret', 's3cr3t'), ('functions_url', 'https://x/functions/v1');

set role anon;
select tst.denied($$select config('cron_secret')$$, 'anon reads cron secret through config()');
select tst.denied($$select server_config('cron_secret')$$, 'anon calls server_config()');
select tst.denied($$select item_names(array[]::uuid[])$$, 'anon calls item_names()');
select tst.denied($$select drop_empty_missing_queues()$$, 'anon calls drop_empty_missing_queues()');
select tst.denied($$select search_items(gen_random_uuid(), 'x')$$, 'anon calls search_items()');
select tst.ok(keepalive() is not null, 'anon keepalive still works');
reset role;

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(config('cron_secret') is null, 'config() hides the cron secret');
select tst.ok(config('functions_url') is null, 'config() hides the functions url');
select tst.ok(config('did_you_mean_threshold') = '0.4', 'config() returns tuning keys');
select tst.denied($$select server_config('cron_secret')$$, 'authenticated calls server_config()');
select tst.denied($$select flush_missing_queue()$$, 'authenticated calls flush_missing_queue()');
select tst.denied($$select claim_outbox(1)$$, 'authenticated calls claim_outbox()');
select tst.denied($$select notify('x', 'y')$$, 'authenticated calls notify()');
select tst.denied($$select item_names(array[]::uuid[])$$, 'authenticated calls item_names()');
reset role;

-- Every function anon or authenticated can run is on purpose.
select tst.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('keepalive')
), 'anon can execute only keepalive');

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
update notification_outbox set sent_at = now() - interval '8 days' where body = 'one';
select tst.ok(purge_outbox() = 2, 'purge removes old sent and abandoned rows');
