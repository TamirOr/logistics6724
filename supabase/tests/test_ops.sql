-- Productization: audit log, job runs, health report and the support RPCs.
-- Runs after test_flows.sql and uses its users.
set client_min_messages = warning;
create function tst.v(p_key text) returns uuid language sql as $$ select v from tst.t where k = p_key $$;
grant execute on function tst.v to authenticated;

-- Audit log -------------------------------------------------------------------
truncate audit_log;
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'audit_event', create_event('בדיקת יומן', 'company');
reset role;
select tst.ok((select count(*) from audit_log where table_name = 'events' and op = 'insert'
  and actor = '10000000-0000-0000-0000-000000000002' and event_id = tst.v('audit_event')) = 1,
  'opening an event is logged with its actor');
select tst.ok((select count(*) from audit_log where table_name = 'lists' and event_id = tst.v('audit_event')) = 1,
  'its list is logged under the event');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into requests (list_id, supplier_id, item_id, quantity)
select l.id, i.supplier_id, i.id, 3 from lists l, items i
where l.event_id = tst.v('audit_event') and i.name = 'סוללה AA';
update requests set quantity = 5 where event_id = tst.v('audit_event');
reset role;
select tst.ok((select changed -> 'quantity' from audit_log where table_name = 'requests' and op = 'update'
  and event_id = tst.v('audit_event')) = '[3, 5]', 'an update records only the old and new value');
select tst.ok(not exists (select 1 from audit_log where table_name = 'requests' and op = 'update'
  and changed ? 'updated_at'), 'bookkeeping columns are left out');

-- Users: role changes are logged, personal data is not.
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select set_user_active('10000000-0000-0000-0000-000000000005', false);
select set_user_active('10000000-0000-0000-0000-000000000005', true);
reset role;
select tst.ok((select count(*) from audit_log where table_name = 'users'
  and row_id = '10000000-0000-0000-0000-000000000005' and changed ? 'active') = 2, 'deactivation is logged');
select tst.ok(not exists (select 1 from audit_log where table_name = 'users'
  and (changed ? 'email' or changed ? 'service_number' or changed ? 'first_name')), 'no personal data in the user audit');

-- Only admins read it; nobody writes it directly.
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select count(*) from audit_log) = 0, 'a customer reads no audit rows');
select tst.fails($$insert into audit_log (table_name, row_id, op, changed) values ('x', 'y', 'insert', '{}')$$,
  'a customer writes the audit log');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok((select count(*) from audit_log) > 0, 'an admin reads the audit log');
select tst.fails($$delete from audit_log$$, 'an admin deletes audit rows');
reset role;

-- Archiving deletes the event and its history with it.
delete from events where id = tst.v('audit_event');
select tst.ok(not exists (select 1 from audit_log where event_id = tst.v('audit_event')),
  'archiving an event removes its audit rows');
select tst.ok(not exists (select 1 from audit_log where op = 'delete' and table_name in ('requests', 'lists')
  and row_id not in (select id::text from requests union select id::text from lists)
  and at > now() - interval '1 minute' and event_id is null), 'the archive delete itself is not logged');

-- Retention: audit rows not tied to an event go after the retention window.
update audit_log set at = now() - interval '91 days' where table_name = 'users';
select tst.ok((purge_expired() ->> 'audit_log')::int >= 2, 'old user audit rows are purged');

-- Job runs ----------------------------------------------------------------------
truncate job_runs;
insert into job_runs (job, started_at, finished_at, ok, summary) values
  ('push-dispatch', now() - interval '61 days', now() - interval '31 days', true, '{}');
select tst.ok((purge_expired() ->> 'job_runs')::int = 1, 'job runs are kept 30 days');

-- pg_cron's run history, with a stand-in for the table pg_cron creates.
select tst.ok(purge_expired() ->> 'cron_runs' is null, 'the purge skips cron history where pg_cron is missing');
create schema cron;
create table cron.job_run_details (runid bigserial primary key, status text, start_time timestamptz);
insert into cron.job_run_details (status, start_time) values
  ('succeeded', now() - interval '8 days'), ('succeeded', now() - interval '6 days');
select tst.ok((purge_expired() ->> 'cron_runs')::int = 1, 'cron runs older than 7 days are purged');
select tst.ok((select count(*) from cron.job_run_details) = 1, 'cron runs of the last week are kept');
drop schema cron cascade;
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select * from job_runs$$, 'an admin reads job runs directly');
reset role;

-- Metrics and health report -------------------------------------------------------
truncate notification_outbox, job_runs;
delete from app_config where key = 'functions_url';
select tst.ok((health_report() ->> 'ok')::boolean, 'a quiet fresh project is healthy');

-- Push backlog.
select notify('approved', 'late', p_user => '10000000-0000-0000-0000-000000000002');
update notification_outbox set created_at = now() - interval '11 minutes';
select tst.ok((ops_metrics() ->> 'outbox_unsent')::int = 1, 'metrics count the unsent row');
select tst.ok(not (health_report() ->> 'ok')::boolean, 'an unsent notification older than 10 minutes fails');
update notification_outbox set sent_at = created_at + interval '30 seconds';
select tst.ok((ops_metrics() ->> 'push_p95_seconds')::numeric = 30, 'push latency from created to sent');
select tst.ok((health_report() ->> 'ok')::boolean, 'healthy again once it is sent');

-- Dispatcher: once deployed, it must have succeeded in the last 10 minutes.
insert into app_config (key, value) values ('functions_url', 'https://x/functions/v1');
select tst.ok(not (health_report() ->> 'ok')::boolean, 'a deployed dispatcher that never ran fails');
insert into job_runs (job, started_at, ok, summary) values
  ('push-dispatch', now(), true, '{"sent": 9, "failed": 1, "removed": 2}');
select tst.ok((health_report() ->> 'ok')::boolean, 'a recent dispatcher run passes');
select tst.ok((ops_metrics() ->> 'push_devices_removed_24h')::int = 2, 'removed devices are counted');
insert into job_runs (job, started_at, ok, summary) values ('push-dispatch', now(), true, '{"sent": 0, "failed": 5}');
select tst.ok(not (health_report() ->> 'ok')::boolean, 'more than 20% failed sends fails');
select tst.ok(exists (select 1 from jsonb_array_elements(health_report() -> 'checks') c
  where c ->> 'name' = 'push_failure_ratio_24h' and not (c ->> 'ok')::boolean), 'the failing check is named');
delete from job_runs where summary ->> 'failed' = '5';

-- Thresholds change without a deploy.
update app_config set value = '0' where key = 'health_db_max_mb';
select tst.ok(not (health_report() ->> 'ok')::boolean, 'database size over the threshold fails');
update app_config set value = '400' where key = 'health_db_max_mb';

-- Backups: checked once the first one has run.
insert into job_runs (job, started_at, finished_at, ok) values ('backup', now() - interval '27 hours', now() - interval '27 hours', true);
select tst.ok(not (health_report() ->> 'ok')::boolean, 'a backup older than 26 hours fails');
insert into job_runs (job, started_at, ok) values ('backup', now(), true);
select tst.ok((health_report() ->> 'ok')::boolean, 'a fresh backup passes');

-- Archive: checked only when configured and something is past retention.
insert into job_runs (job, started_at, finished_at, ok, summary)
values ('archive', now() - interval '3 days', now() - interval '3 days', true, '{"configured": true}');
select tst.ok((health_report() ->> 'ok')::boolean, 'an old archive run passes while nothing is past retention');
insert into events (name, scope, needed_on, created_at) values ('ישן', 'company', current_date, now() - interval '100 days');
select tst.ok(not (health_report() ->> 'ok')::boolean, 'events past retention with a stale archive fail');
delete from events where name = 'ישן';

-- Who may read what.
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select admin_health()$$, 'a customer reads the health report');
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(admin_health() ? 'checks', 'an admin reads the health report');
reset role;
set role service_role;
select tst.ok(health_report() ? 'metrics', 'the service role reads the health report');
reset role;
select tst.ok(health_report()::text !~ '@', 'the health report holds no email addresses');

-- Test notification ----------------------------------------------------------------
truncate notification_outbox;
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000004');
select send_test_notification();
select tst.fails($$select send_test_notification()$$, 'a second test within a minute');
select tst.act('99999999-0000-0000-0000-000000000000');
select tst.fails($$select send_test_notification()$$, 'someone without a profile sends a test');
reset role;
select tst.ok((select count(*) from notification_outbox where kind = 'test'
  and target_user = '10000000-0000-0000-0000-000000000004') = 1, 'the test goes to the caller only');

-- Support view and access review ------------------------------------------------------
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-000000000004', 'https://fcm.googleapis.com/fcm/send/support', 'k', 'a');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok(jsonb_array_length(user_support('10000000-0000-0000-0000-000000000004') -> 'devices') = 1,
  'support view lists the user''s devices');
select tst.ok(jsonb_array_length(user_support('10000000-0000-0000-0000-000000000004') -> 'notifications') = 1,
  'support view lists notifications sent to them');
select tst.ok((select count(*) from access_review() where role = 'admin') = 1, 'access review lists admins');
select tst.ok(not exists (select 1 from access_review() where role = 'customer'), 'access review leaves out customers');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails($$select user_support('10000000-0000-0000-0000-000000000004')$$, 'a supplier opens the support view');
select tst.fails($$select * from access_review()$$, 'a supplier runs the access review');
reset role;
delete from push_subscriptions;

-- Client version gate ---------------------------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(config('min_client_version') = '0', 'the app reads min_client_version');
select tst.ok(config('health_db_max_mb') is null, 'health thresholds stay server-only');
reset role;

-- Leave the shared state as test_security.sql expects it.
delete from app_config where key = 'functions_url';
truncate notification_outbox, job_runs;
