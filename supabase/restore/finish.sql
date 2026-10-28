-- Restore drill, part 3 of 3. Puts staging's own settings back and drops
-- production's devices and queued notifications, so staging can never
-- push to a real phone.
delete from public.app_config;
insert into public.app_config select * from staging_config;
truncate public.push_subscriptions, public.notification_outbox;
set session_replication_role = origin;
