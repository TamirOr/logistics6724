# לוגיסטיקה גדודית: battalion logistics requests

Companies request equipment, suppliers prepare it and mark what they supplied, and each company sees the state of its requests live. Hebrew, right to left, mobile first. It runs on free tiers only.

Product spec: https://claude.ai/artifact/6gqAbnwn1YPEQNqroz6oK6. Coding rules for contributors (and Claude): [CLAUDE.md](CLAUDE.md).

## Architecture

A static React PWA talks directly to Supabase. There is no application server.

| Part | Where |
| --- | --- |
| Schema, RLS, business rules | `supabase/migrations/` |
| Push sending, archiving | `supabase/functions/` (Deno Edge Functions) |
| Web app (Vite + React PWA) | `web/` |
| Deploy, health, backups and CI | `.github/workflows/`, `scripts/` |
| Runbook (alerts, support, restore) | `docs/runbook.md` |

Every permission is enforced in the database. Customers, suppliers and admins all use the anon key; row-level security and guard triggers decide what each one can read and write. Secrets (cron secret, VAPID private key) live in `app_config` and are readable only by the service role.

## Local development

Tests run against plain Postgres 15+ with `pg_trgm`. No Docker is needed.

```bash
# Database tests: applies every migration to a fresh DB, then runs supabase/tests/test_*.sql
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh

# Web
cd web
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev                  # http://localhost:5173
npm test                     # unit tests
npm run build
```

With Docker you can also run the full stack locally with `supabase start` (uses `supabase/config.toml`).

## Deploying (browser only)

Everything deploys from GitHub Actions. No terminal or CLI is needed: you set things up once in the browser. All the links below are web pages; open them in the browser you use for GitHub and Supabase.

### Environments

There are two Supabase projects, which is what the free plan allows:

| | Staging | Production |
| --- | --- | --- |
| Supabase project | a second free project | the original project |
| Web app | `https://<owner>.github.io/<repo>/staging/` | `https://<owner>.github.io/<repo>/` |
| Deploys on | every push to `main` | a tag `v*` |
| Before deploying | the full CI suite | the full CI suite |
| Before migrations | nothing | a fresh encrypted backup |
| After deploy | nothing | health check 10 minutes later; GitHub release with notes |
| Data | fake units and catalog (Deploy → "Seed staging") | real |
| Sentry environment | `staging` | `production` |
| Push keys, email | its own VAPID keys; `STAGING_SMTP_*` (a test inbox) | its own; `SMTP_*` |

Both builds live on the `site` branch, which GitHub Pages serves. Source maps go to Sentry and are never published. First load of a deep link under `/staging/` opens production's 404 page; open the staging root instead (after that, staging's own service worker serves its pages).

### One-time setup

1. **Supabase access token.** Open https://supabase.com/dashboard/account/tokens, choose "Generate new token", name it `github-deploy`, and copy the token. Give it access to the whole organization, not to one project: the same token deploys both staging and production. A token limited to one project gets "Your account does not have the necessary privileges" for the other.
2. **Projects.** For each project (create the staging one at https://supabase.com/dashboard/new; choose the same region), open Project Settings → General and copy the **Project ID** (the ref). Under Project Settings → Database, use "Reset database password" if you don't have it, and copy the new password.
3. **GitHub secrets.** In the repository, open Settings → Secrets and variables → Actions → "New repository secret" and add:
   - `SUPABASE_ACCESS_TOKEN`: the token from step 1
   - `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`: production
   - `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_DB_PASSWORD`: staging (until they exist, pushes to `main` only run the tests)
4. **GitHub Pages.** Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch `site`, folder `/ (root)`. The branch appears after the first deploy; until then, run a deploy first and come back.
5. **Security.** Settings → Code security: turn on **Dependabot alerts**, **Secret scanning** and **Push protection**.
6. **Deploy.** Merge to `main` (staging), or open Actions → Deploy → "Run workflow" and pick a target.

### Releasing to production

Open Releases → "Draft a new release" → "Choose a tag" → type the next version (`v1.4.0`) → "Create new tag on publish" → Publish. The tag starts the Deploy workflow, which runs every test suite, takes a backup, migrates, deploys, checks health after 10 minutes and writes the release notes from the commit messages. To roll back the web app, run Deploy from the previous tag (see docs/runbook.md).

Migrations must keep working with the previous web build for one release (expand, then contract), because phones update only when the user taps the update banner. CI asks for the `db-breaking` label on a PR whose new migration drops, renames or changes a column type; see the runbook for `min_client_version`.

### First admin and units

1. Open the app and sign in once with the admin's email. The app shows the sign-up form; you can ignore it.
2. In GitHub, open Actions → Deploy → "Run workflow", choose the target, fill in **admin_email**, and run it.
3. Reload the app. As admin, add the companies and suppliers under "יחידות", with each company's headcount (סד״כ). Supplier sections on the event screen appear in alphabetical order.
4. The initial catalog goes in later as a new seed migration. The app works with an empty catalog.

### Sign-in emails (needed for 6-digit codes)

On the free plan, Supabase sends sign-in emails with its default template, which contains a **link**, not the 6-digit code. The app accepts the link, which works in a browser and on Android. But an app installed on an iPhone home screen cannot use it. To send codes, give the project its own email sender. The next deploy then installs the code template.

**Gmail (simplest).** Use a Gmail account that has 2-Step Verification on. Open https://myaccount.google.com/apppasswords, create an app password named `logistics`, and copy the 16 characters. Then add these GitHub secrets (Settings → Secrets and variables → Actions). For staging, add the same with a `STAGING_` prefix (a test inbox is fine):

| Secret | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | the Gmail address |
| `SMTP_PASS` | the app password, without spaces |
| `SMTP_SENDER` | the Gmail address |

Gmail sends up to about 500 emails a day, far more than sign-ins need.

**Brevo (no personal address as sender).** Create a free account at https://www.brevo.com (300 emails a day). Add and verify a sender address under Senders, and generate an SMTP key under SMTP & API. Use `SMTP_HOST` = `smtp-relay.brevo.com`, `SMTP_PORT` = `587`, `SMTP_USER` = the SMTP login Brevo shows, `SMTP_PASS` = the key, and `SMTP_SENDER` = the verified address.

After adding the secrets, run Actions → Deploy → "Run workflow".

### Archiving and backups to Google Drive

The `archive` function needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `DRIVE_FOLDER_ID` as Edge Function secrets (Supabase → Edge Functions → Secrets). Until they are set, events stay in the database past 90 days. A service account won't work, because it has no storage quota of its own. Use an OAuth client and a refresh token for the account that owns the folder, with the `drive.file` scope.

Add the same four values as GitHub secrets too: the nightly **Backup** workflow uploads encrypted backups to the same folder. It also needs an age public key in `ops/backup-recipients.txt`; see docs/runbook.md, Backups. Production deploys stop at the backup step until backups work (Deploy → "skip backup" for emergencies).

### Monitoring and alerts

All free plans. Every alert ends in an email; nobody needs to watch a dashboard.

- **Health workflow** (`.github/workflows/health.yml`) runs every 30 minutes for both projects and fails when a threshold in `health_report()` is crossed. GitHub emails the failure. It also keeps the free projects from pausing.
- **Sentry** (https://sentry.io, free Developer plan). Create a React project, then add GitHub secrets `SENTRY_DSN` (Settings → Client Keys), and for readable stack traces `SENTRY_AUTH_TOKEN` (Settings → Auth Tokens, scope `project:releases`), `SENTRY_ORG` and `SENTRY_PROJECT` (the slugs). The web app and both Edge Functions report to it, tagged with the git SHA and the environment. Under Alerts, create an issue alert: "A new issue is created" or "The issue is seen more than 20 times in one hour", action: email.
- **Uptime monitor** (https://uptimerobot.com or https://betterstack.com/uptime, free). Two HTTP monitors every 5 minutes, alerting by email:
  1. the production site URL, expecting 200;
  2. `https://<project-ref>.supabase.co/rest/v1/rpc/health`, method POST, body `{}`, headers `apikey: <anon key>` and `Content-Type: application/json`, expecting 200 and the keyword `true`. The anon key is public (it is in the web app); find it under Project Settings → API.

What each alert means and how to fix it: [docs/runbook.md](docs/runbook.md). Support tools in the app: every user has **אבחון** (diagnostics) in the header; admins can open any user's support view from משתמשים, and see a health strip on the home screen.

## Configuration

Every setting, where it lives, and its value per environment ("secret" means: never written down here).

| Setting | Where | Staging | Production |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | GitHub secret | secret (shared) | secret (shared) |
| `SUPABASE_PROJECT_REF` / `STAGING_SUPABASE_PROJECT_REF` | GitHub secret | staging ref | production ref |
| `SUPABASE_DB_PASSWORD` / `STAGING_SUPABASE_DB_PASSWORD` | GitHub secret | secret | secret |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER` (`STAGING_` prefix for staging) | GitHub secret, optional | test inbox | real sender |
| `SENTRY_DSN` | GitHub secret, optional; copied into the build (`VITE_SENTRY_DSN`) and Edge Function secrets | shared | shared |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | GitHub secret, optional | shared | shared |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_ID` | Edge Function secrets (archive) and GitHub secrets (backups) | optional | secret |
| `BACKUP_AGE_KEY` | GitHub secret, only during a restore drill | — | — |
| `APP_VERSION`, `SENTRY_ENVIRONMENT` | Edge Function secrets, set by Deploy | git SHA, `staging` | git SHA, `production` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build, set by Deploy (the build fails without them) | staging | production |
| `VITE_APP_VERSION`, `VITE_APP_BUILT_AT`, `VITE_SENTRY_ENVIRONMENT` | build, set by Deploy | git SHA, commit time, `staging` | same, `production` |
| `functions_url`, `site_url` | `app_config`, set by Deploy | staging URLs | production URLs |
| `cron_secret`, `vapid_private_key` | `app_config`, server-only, generated | secret | secret |
| `vapid_public_key` | `app_config`, readable by the app | generated | generated |
| `ops/backup-recipients.txt` | repository | — | age public keys |
| Tuning values and health thresholds | `app_config` (below) | defaults | defaults |

## Tuning values

These live in `app_config` and can change without a deploy:

| Key | Default | Meaning |
| --- | --- | --- |
| `did_you_mean_threshold` | 0.4 | Word similarity needed for "התכוונת ל...?" |
| `missing_window_minutes` | 5 | Each missing mark delays the grouped notification this long |
| `missing_window_cap_minutes` | 15 | Latest send time, counted from the first mark |
| `retention_days` | 90 | Age at which events move to Drive; also how far back history shows |
| `auto_close_quiet_minutes` | 30 | How long an event must be done, with no changes, before it closes |
| `min_client_version` | 0 | Builds with an older commit time (Unix seconds) stop writing and ask to update; see the runbook |

Health thresholds (server-only, read by `health_report()`):

| Key | Default | Fails when |
| --- | --- | --- |
| `health_outbox_max_minutes` | 10 | the oldest unsent notification is older |
| `health_dispatch_max_quiet_minutes` | 10 | push-dispatch has not succeeded for longer |
| `health_push_max_failure_ratio` | 0.2 | a larger share of pushes failed in 24 hours |
| `health_archive_max_hours` | 48 | the archive has not succeeded for longer while events are past retention |
| `health_db_max_mb` | 400 | the database is larger (free limit 500) |
| `health_backup_max_hours` | 26 | the last backup is older |

The time zone (Asia/Jerusalem) is fixed: `timezone` in `app_config` for the database and `TIMEZONE` in `supabase/functions/_shared/dates.ts` for the app and Excel. Change both together.
