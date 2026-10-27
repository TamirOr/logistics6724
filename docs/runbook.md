# Runbook

One entry per alert and per common complaint: what it means, what to look at, how to fix it. SQL runs in the Supabase dashboard → SQL Editor of the project in question (production unless it says staging).

Alerts arrive by email from three places:

| Source | Sends | Configure |
| --- | --- | --- |
| GitHub | A failed **Health**, **Backup** or **Deploy** run | Automatic for the repository owner. Settings → Notifications → Actions: "Send notifications for failed workflows only" |
| Sentry | A new issue, or one issue over 20 events an hour | Sentry → Alerts (see README, Monitoring) |
| Uptime monitor | The site or `rpc/health` not answering | UptimeRobot or Better Stack (see README, Monitoring) |

Start with the overview, which is the same report the health workflow checks:

```sql
select jsonb_pretty(health_report());
```

The admin home shows it too: a green strip, or a red one that names the failing checks.

## Health checks

The **Health** run's log lists every check as `PASS` or `FAIL` with its value and limit. Thresholds are in `app_config` and can change without a deploy:

```sql
select key, value from app_config where key like 'health_%' order by key;
update app_config set value = '15' where key = 'health_outbox_max_minutes';
```

### `outbox_oldest_unsent_minutes`: push backlog

A notification has waited more than 10 minutes. Companies are not hearing about their requests.

```sql
select id, kind, created_at, attempts, claimed_at, last_error
from notification_outbox where sent_at is null order by id limit 20;
select job, ok, finished_at, summary, error from job_runs where job = 'push-dispatch' order by finished_at desc limit 10;
```

- `last_error` mentions 401/403 or "VAPID": see **VAPID mismatch** below.
- No recent `push-dispatch` rows: see `dispatch_last_ok_minutes`.
- Rows with `attempts = 5` are abandoned and no longer retried. To retry them once the cause is fixed: `update notification_outbox set attempts = 0, claimed_at = null where sent_at is null;`

### `dispatch_last_ok_minutes`: push-dispatch is not running

No successful run in 10 minutes. Either pg_cron stopped calling it, or every run fails.

```sql
select jobname, schedule, active from cron.job order by jobname;
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 10;
select status_code, error_msg, left(content::text, 200), created from net._http_response order by created desc limit 10;
select key from app_config where key in ('functions_url', 'cron_secret', 'vapid_public_key', 'vapid_private_key');
```

- `net._http_response` shows 401: the function and the database disagree on the cron secret. Run the Deploy workflow (it does not change the secret), or rotate it (below).
- 404: the function is not deployed. Run the Deploy workflow.
- 5xx: open Sentry (the `push-dispatch` issue), or Supabase → Edge Functions → push-dispatch → Logs. Each run logs one JSON line with `run_id`, `claimed`, `sent`, `failed` and `error`.
- `functions_url` missing: run the Deploy workflow, whose configure step stores it.

### `cron_failed_1h`: a scheduled job failed

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where d.status = 'failed' order by d.start_time desc limit 10;
```

The message names the job and the SQL error. `close-finished-events` and `purge-expired` run SQL directly; `push-dispatch` and `archive` only post to their function, so their failures are usually pg_net errors (see above).

### `push_failure_ratio_24h`: pushes are failing

More than 20% of sends failed in 24 hours.

```sql
select left(last_error, 160) as error, count(*) from notification_outbox
where last_error is not null and created_at > now() - interval '24 hours' group by 1 order by 2 desc;
```

- 403 or "VAPID" from every push service: **VAPID mismatch**.
- One push service failing (for example `web.push.apple.com` timeouts): usually theirs; it clears on its own. Rows are retried up to 5 times.
- 410/404 are not failures: those devices unsubscribed and were removed (`push_devices_removed_24h` in the metrics).

### `archive_last_ok_hours`: archiving stopped

Events are past the 90-day retention and the archive has not succeeded for 2 days. The database grows toward the 500 MB free limit.

```sql
select finished_at, ok, summary, error from job_runs where job = 'archive' order by finished_at desc limit 5;
select count(*) from archive_candidates();
```

- `error` mentions `token: 400`: the Google refresh token expired or was revoked. Create a new one and update `GOOGLE_REFRESH_TOKEN` in Supabase → Edge Functions → Secrets **and** in the GitHub secrets (backups use it too).
- "file holds N rows, expected M; nothing deleted": the uploaded file did not read back complete. Nothing was lost; the next run tries again. If it repeats, check the Drive folder for a damaged `logistics-YYYY-MM.xlsx` and rename it aside (the next run starts a fresh file for that month).

### `db_size_mb`: database over 400 MB

80% of the free 500 MB. Usually the archive is not running (above). Find the large tables:

```sql
select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables
order by pg_total_relation_size(relid) desc limit 10;
```

`audit_log` and `notification_outbox` shrink with the daily `purge-expired` job. To reclaim space after a large purge: `vacuum full audit_log;`.

### `backup_last_ok_hours`: no backup in 26 hours

The **Backup** workflow failed or is not running. Its run log names the step:

- "no age public key yet": add one (see **Backups** below).
- `pg_dump: server version mismatch`: Supabase upgraded Postgres beyond 17. Change `postgresql-client-17` and the `17` in the PATH line of `.github/workflows/backup.yml` and `restore-drill.yml`.
- Drive errors: same token as the archive (above).

## Uptime monitor alerts

### Site down (Pages URL not 200)

Check https://www.githubstatus.com. If GitHub is fine, open Settings → Pages: the source must be the `site` branch, root folder. Re-run the last Deploy if the branch is empty.

### `rpc/health` down: project paused or Supabase down

Open the Supabase dashboard. A paused project shows "Restore project". Restoring takes a few minutes and keeps all data. Then check why the Health workflow did not keep it awake (it calls `rpc/health` every 30 minutes): is the workflow enabled under Actions? GitHub disables scheduled workflows after 60 days without repository activity; re-enable it there. If Supabase itself is down: https://status.supabase.com, nothing to do but wait.

## Sentry

- **New issue from `web`**: the stack trace names the screen. The issue's tags show the release (git SHA), role and environment. A crash shows users the "משהו השתבש" screen with a reload button.
- **`write rejected: <kind> <table or rpc> (<code>)`**: the server refused a write the UI allowed. Most likely a database rule and the UI disagree. The code says which: `42501` row-level security, `P0001` a rule in a trigger or RPC (the message on the user's phone says which), `23514` a check constraint, `0ROWS` an update that matched no row (refused by RLS or the row is gone). Reproduce on staging with the same role.
- **`push-dispatch` or `archive`**: see the matching health check above.

## Common complaints

### "I didn't get the notification"

1. Ask for the diagnostics text (account bar → אבחון → העתקה). Check `push:` (must be `granted`, `subscribed: yes`) and `mode:` (on iPhone it must say `home screen`).
2. Admin → משתמשים → the user's name opens their support view: their devices with the last successful delivery, and the notifications that should have reached them, with status and error.
3. A notification with "לא נשלחה": see the push backlog check above.
4. Sent, but the phone shows nothing: ask them to tap "שליחת התראת בדיקה" on the diagnostics screen. If that does not arrive either, the phone is blocking it (Focus mode, notification settings, battery saver).

### iPhone not receiving pushes

Push works on iPhone only from the app on the home screen (iOS 16.4 or later), and the home-screen app does not share the Safari sign-in. On the diagnostics screen, `mode` must be `home screen` and `push` must be `granted`. If not: open the app from the home-screen icon, sign in there, tap "הפעלת התראות". If it says granted but `subscribed: no`, "ניקוי נתונים מקומיים וטעינה מחדש" and enable notifications again. In iOS Settings → Notifications → לוגיסטיקה, notifications must be allowed.

### "My change disappeared"

1. Diagnostics: `queue` greater than 0 means changes are still on the phone waiting for a connection. They are sent when it reconnects. `rejected:` lines are changes the server refused, with the code (see Sentry, above).
2. Was it received? Admin → the user's support view → שינויים אחרונים, or:

```sql
select at, table_name, op, changed from audit_log
where actor = '<user id>' order by at desc limit 30;
-- who changed one request:
select at, actor, op, changed from audit_log where table_name = 'requests' and row_id = '<request id>' order by at;
```

### User stuck on "ממתין לאישור"

They signed up and an admin has not approved them yet: admin home → בקשות הצטרפות. If they are not listed:

```sql
select id, role, unit_id, approval, active, created_at from users where email = '<their email>';
```

- No row: they never finished the sign-up form. Ask them to sign in again and fill it.
- `approval = 'approved'` but still waiting: the app checks again every 30 seconds and when it comes to the front. Ask them to close and reopen it. `active = false` means they were deactivated (the screen then says "החשבון אינו פעיל").

## Procedures

### VAPID mismatch after a key change

The VAPID keys are generated once by the deploy and kept in `app_config`. Every device subscribed with the public key. If the keys change (a restore from another project, a manual edit), push services answer 403 for every old subscription.

```sql
select key, left(value, 12) from app_config where key like 'vapid_%';
```

Fix: delete the old subscriptions so devices register again with the current key, and tell users to open the app (it re-subscribes on start when permission is granted):

```sql
delete from push_subscriptions;
```

Never rotate VAPID keys on purpose unless the private key leaked: it cuts off every subscribed device until each user opens the app again.

### Rotating the cron secret

Actions → Deploy → Run workflow → target, tick "Replace the cron secret". pg_cron, `wake_dispatcher` and both functions read it from `app_config` on each run, so nothing else changes. Do it if the secret may have leaked.

### A breaking schema change (`min_client_version`)

Phones run the old build until their service worker updates, which waits for the user to tap the update banner. So every migration must work with the previous web build for one release: **expand, then contract**. Add the new column or function in one release; stop using the old one in the app; remove it in a later release.

When a change cannot be made compatible:

1. Label the PR `db-breaking` (CI requires it for drops, renames, type changes and truncates).
2. Deploy to staging and rehearse with an old build open on a phone.
3. After the production deploy, set the minimum build to the new release's commit time. The production Deploy run shows it in its **Build** notice as `built_at` (Unix seconds):

```sql
update app_config set value = '<commit time>' where key = 'min_client_version';
```

Older builds then stop sending writes (they stay on the phone) and show "נדרש עדכון" with an update button. After the update, the queued writes are sent by the new build.

### Rolling back

- **Web**: Actions → Deploy → Run workflow → target production, from the previous tag (choose the tag in "Use workflow from"). Production deploys still need approval.
- **Database**: never edit or revert an applied migration. Write a forward fix migration. Restore from a backup only after data loss.

### Deleting a user on request

Deleting the auth user removes their profile (`users`) with it; their name, email and service number exist nowhere else. Their requests stay with `created_by` emptied, and audit rows keep only role and unit changes, with `actor` emptied.

```sql
delete from auth.users where email = '<their email>';
```

Backups still hold them until the backups age out (14 days daily, 8 weeks weekly).

## Backups

Nightly at 01:37 UTC and before every production deploy, the **Backup** workflow dumps the data of the `public` and `auth` schemas, encrypts it with [age](https://age-encryption.org) to the public keys in `ops/backup-recipients.txt`, and uploads `backup-production-YYYY-MM-DD.tar.gz.age` to the Drive folder the archive uses. It keeps 14 daily and 8 weekly copies. The schema itself is the migrations in git; `manifest.json` in the backup names the last migration it was taken at.

**Keys.** The owner and one deputy each create a key pair once, on their own computer: `age-keygen -o logistics-backup-key.txt`. It prints the public key (`age1...`); add it as a line in `ops/backup-recipients.txt`. Keep the key file offline (a password manager or a USB stick), never in the repository or a chat.

### Restore drill (before launch, then every quarter)

1. Add your private key as the GitHub secret `BACKUP_AGE_KEY` (the whole content of the key file).
2. Actions → Restore drill → Run workflow. It restores the newest backup into **staging**, checks each table's row count against the dump, then removes the restored data and seeds staging again. Staging keeps its own settings and gets none of production's devices, so it cannot notify real phones.
3. Delete the `BACKUP_AGE_KEY` secret.
4. Log it below.

| Date | Backup restored | Result | By |
| --- | --- | --- | --- |
| | | | |

### Disaster recovery (production lost)

Target: back within 2 hours, losing at most a day.

1. Create a new Supabase project. Put its ref and database password in `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`.
2. Actions → Deploy → Run workflow → production, from the tag whose migrations match the backup's `manifest.json` (or newer). This creates the schema, functions and settings.
3. Restore the data with the same SQL the drill uses, from a computer with `psql` and `age` (connection string: Supabase → Connect → Session pooler):

```bash
age --decrypt -i logistics-backup-key.txt backup-production-YYYY-MM-DD.tar.gz.age | tar -xz
psql "$SESSION_POOLER_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase/restore/prepare.sql -f data.sql
```

   Unlike the drill, skip `finish.sql`: production needs the restored `app_config` (its VAPID keys keep phones subscribed) and the restored `push_subscriptions`. Then run the Deploy workflow again so `functions_url` and `site_url` point at the new project.
4. The anon key changed, so the deploy rebuilds the web app. Phones pick it up on the next update.

## Secrets inventory

| Secret | Where | Rotate | If it changes |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | GitHub secret | Supabase → Account → Access tokens; replace the secret | Nothing else |
| `SUPABASE_DB_PASSWORD` / `STAGING_…` | GitHub secret | Supabase → Project Settings → Database → Reset password; replace the secret | Nothing else |
| `cron_secret` | `app_config` (database only) | Deploy → "Replace the cron secret" | Nothing else |
| `vapid_private_key` / `vapid_public_key` | `app_config` | Only if leaked: delete both rows, run Deploy | Every device must re-subscribe (see VAPID mismatch) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_ID` | Edge Function secrets **and** GitHub secrets | Google Cloud console → new client secret or token; update both places | Archive and backups fail until both are updated |
| `SMTP_PASS` / `STAGING_SMTP_PASS` | GitHub secret | New app password at the provider; replace the secret; run Deploy | Sign-in emails fail until deployed |
| `SENTRY_DSN` | GitHub secret, copied into the build and Edge Function secrets | Sentry → Client Keys; replace; run Deploy for both targets | Old builds report to the old key until they update |
| `SENTRY_AUTH_TOKEN` | GitHub secret | Sentry → Auth Tokens (scope: project:releases) | Source maps not uploaded |
| Backup private key | Offline, owner and deputy | New pair; replace the public key in `ops/backup-recipients.txt` | Old backups still need the old key until they age out |
| `BACKUP_AGE_KEY` | GitHub secret, only during a restore drill | Delete after each drill | — |

## Retention

| Data | Kept | Removed by |
| --- | --- | --- |
| Events, lists, requests | 90 days after closing (`retention_days`) | `archive` moves them to Drive as Excel |
| Audit rows of an event | With the event | Deleted with the event |
| Audit rows about users and units | 90 days | `purge-expired`, daily |
| Notifications (outbox) | 14 days | `purge-expired` |
| Job runs | 30 days | `purge-expired` |
| Backups | 14 daily + 8 weekly | `backup.yml` prune step |
| Rejected-write log on a phone | Last 5, until sign-out | The app |
