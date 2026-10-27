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

The workflow applies the migrations, deploys the Edge Functions and turns on 6-digit email codes. It also generates the cron secret and the push keys, which stay in the database.

### First admin and units

1. Open the app and sign in once with the admin's email. The app shows the sign-up form; you can ignore it.
2. In GitHub, open Actions → Deploy → "Run workflow", fill in **admin_email**, and run it.
3. Reload the app. As admin, add the companies and suppliers under "יחידות". The order field sets the order of supplier sections on the customer event screen.
4. The initial catalog goes in later as a new seed migration. The app works with an empty catalog.

### Optional: more sign-in emails

Supabase's built-in email allows only a few emails per hour. Before rollout, create a free account at https://resend.com, verify a sending domain, create an API key, and add these GitHub secrets: `SMTP_HOST` = `smtp.resend.com`, `SMTP_PORT` = `587`, `SMTP_USER` = `resend`, `SMTP_PASS` = the API key, `SMTP_SENDER` = an address on your domain. The next deploy switches to it.

### Optional: archiving to Google Drive

The `archive` function needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `DRIVE_FOLDER_ID` as Edge Function secrets (Supabase → Edge Functions → Secrets). Until they are set, events stay in the database past 90 days. A service account won't work, because it has no storage quota of its own. Use an OAuth client and a refresh token for the account that owns the folder, with the `drive.file` scope.

### Keepalive

`.github/workflows/keepalive.yml` uses the same secrets and calls the API every 3 days, so a quiet week doesn't pause the free project.

## Tuning values

These live in `app_config` and can change without a deploy:

| Key | Default | Meaning |
| --- | --- | --- |
| `did_you_mean_threshold` | 0.4 | Similarity needed for "התכוונת ל...?" |
| `missing_window_minutes` | 5 | Each missing mark delays the grouped notification this long |
| `missing_window_cap_minutes` | 15 | Latest send time, counted from the first mark |
| `retention_days` | 90 | Age at which events move to Drive |
| `timezone` | Asia/Jerusalem | Resolves "needed by" times |
