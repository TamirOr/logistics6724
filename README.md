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
| Deploy, keepalive and CI | `.github/workflows/`, `scripts/supabase-admin.mjs` |

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

Everything deploys from GitHub Actions. No terminal or CLI is needed: you set things up once in the browser, and every push to `main` deploys again. All the links below are web pages. Open them in the browser you use for GitHub and Supabase.

### One-time setup

1. **Supabase access token.** Open https://supabase.com/dashboard/account/tokens, choose "Generate new token", name it `github-deploy`, and copy the token.
2. **Project ref and database password.** In your project, open Project Settings → General and copy the **Project ID** (the ref). Under Project Settings → Database, use "Reset database password" if you don't have it, and copy the new password.
3. **GitHub secrets.** In the repository, open Settings → Secrets and variables → Actions → "New repository secret" and add:
   - `SUPABASE_ACCESS_TOKEN`: the token from step 1
   - `SUPABASE_PROJECT_REF`: the Project ID
   - `SUPABASE_DB_PASSWORD`: the database password
4. **GitHub Pages.** In the repository, open Settings → Pages → Build and deployment → Source and choose **GitHub Actions**.
5. **Deploy.** Merge to `main`, or open Actions → Deploy → "Run workflow". The app goes live at `https://<owner>.github.io/<repo>/`.

The workflow applies the migrations, deploys the Edge Functions and configures email sign-in. It also generates the cron secret and the push keys, which stay in the database. For 6-digit codes, also set up a sign-in email sender (below).

### First admin and units

1. Open the app and sign in once with the admin's email. The app shows the sign-up form; you can ignore it.
2. In GitHub, open Actions → Deploy → "Run workflow", fill in **admin_email**, and run it.
3. Reload the app. As admin, add the companies and suppliers under "יחידות", with each company's headcount (סד״כ). Supplier sections on the event screen appear in alphabetical order.
4. The initial catalog goes in later as a new seed migration. The app works with an empty catalog.

### Sign-in emails (needed for 6-digit codes)

On the free plan, Supabase sends sign-in emails with its default template, which contains a **link**, not the 6-digit code. The app accepts the link, which works in a browser and on Android. But an app installed on an iPhone home screen cannot use it. To send codes, give the project its own email sender. The next deploy then installs the code template.

**Gmail (simplest).** Use a Gmail account that has 2-Step Verification on. Open https://myaccount.google.com/apppasswords, create an app password named `logistics`, and copy the 16 characters. Then add these GitHub secrets (Settings → Secrets and variables → Actions):

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

### Optional: archiving to Google Drive

The `archive` function needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `DRIVE_FOLDER_ID` as Edge Function secrets (Supabase → Edge Functions → Secrets). Until they are set, events stay in the database past 90 days. A service account won't work, because it has no storage quota of its own. Use an OAuth client and a refresh token for the account that owns the folder, with the `drive.file` scope.

### Keepalive

`.github/workflows/keepalive.yml` uses the same secrets and calls the API every 3 days, so a quiet week doesn't pause the free project.

## Tuning values

These live in `app_config` and can change without a deploy:

| Key | Default | Meaning |
| --- | --- | --- |
| `did_you_mean_threshold` | 0.4 | Word similarity needed for "התכוונת ל...?" |
| `missing_window_minutes` | 5 | Each missing mark delays the grouped notification this long |
| `missing_window_cap_minutes` | 15 | Latest send time, counted from the first mark |
| `retention_days` | 90 | Age at which events move to Drive; also how far back history shows |
| `auto_close_quiet_minutes` | 30 | How long an event must be done, with no changes, before it closes |

The time zone (Asia/Jerusalem) is fixed: `timezone` in `app_config` for the database and `TIMEZONE` in `supabase/functions/_shared/dates.ts` for the app and Excel. Change both together.
