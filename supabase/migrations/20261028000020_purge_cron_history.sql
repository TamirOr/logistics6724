-- pg_cron keeps a row per run in cron.job_run_details and never deletes
-- them: about 1,700 rows a day here, enough to approach the free plan's
-- 500 MB within a year. The daily purge now keeps a week of them, which is
-- more than the health check looks back (one hour).
--
-- The table exists only where pg_cron is installed, so the delete is
-- dynamic and skipped elsewhere (the SQL tests run on plain Postgres).
create or replace function purge_expired() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_outbox int; v_runs int; v_audit int; v_cron int;
begin
  delete from notification_outbox
  where (sent_at is not null or attempts >= 5) and created_at < now() - interval '14 days';
  get diagnostics v_outbox = row_count;
  delete from job_runs where finished_at < now() - interval '30 days';
  get diagnostics v_runs = row_count;
  delete from audit_log
  where event_id is null and at < now() - (config('retention_days', '90') || ' days')::interval;
  get diagnostics v_audit = row_count;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$delete from cron.job_run_details where start_time < now() - interval '7 days'$q$;
    get diagnostics v_cron = row_count;
  end if;
  return jsonb_build_object('outbox', v_outbox, 'job_runs', v_runs, 'audit_log', v_audit, 'cron_runs', v_cron);
end $$;
