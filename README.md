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
| Keepalive and CI | `.github/workflows/` |

Every permission is enforced in the database. Customers, suppliers and admins all use the anon key; row-level security and guard triggers decide what each one can read and write.

## Local development

Tests run against plain Postgres 15+ with `pg_trgm`. No Docker is needed.

```bash
# Database tests: applies every migration to a fresh DB, then runs supabase/tests/test_*.sql
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh

# Web
cd web
cp .env.example .env.local   # fill in your Supabase URL, anon key, VAPID public key
npm install
npm run dev                  # http://localhost:5173
npm test                     # unit tests
npm run build
```

With Docker you can also run the full stack locally with `supabase start` (uses `supabase/config.toml`).

## Deploying

### 1. Supabase project

1. Create a free project at supabase.com.
2. Apply the migrations: `supabase link --project-ref <ref>`, then `supabase db push`.
3. **Auth → Providers → Email:** enable email sign-in and turn off "Confirm email". Set the OTP length to 6 and the OTP expiry to 600 seconds.
4. **Auth → Email Templates → Magic Link:** paste `supabase/templates/otp.html`. It sends `{{ .Token }}`, a code instead of a link.
5. **Auth → SMTP:** set up an external SMTP provider (for example Resend, free tier). The built-in SMTP allows only a few emails per hour.
6. **Database → Extensions:** make sure `pg_cron` and `pg_net` are enabled, then run the last block of `20261027000004_notifications.sql` again if the migration skipped the jobs.

### 2. Secrets and config

Generate VAPID keys with `npx web-push generate-vapid-keys` and a random cron secret, for example `openssl rand -hex 32`.

```bash
supabase secrets set \
  CRON_SECRET=... \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... DRIVE_FOLDER_ID=...
supabase functions deploy push-dispatch
supabase functions deploy archive
```

Then tell the database where the functions are, in the SQL editor:

```sql
insert into app_config (key, value) values
  ('functions_url', 'https://<ref>.supabase.co/functions/v1'),
  ('cron_secret', '<same CRON_SECRET>')
on conflict (key) do update set value = excluded.value;
```

**Google Drive (archiving).** Create an OAuth client (type "Desktop") in Google Cloud. With the account that owns the archive folder, get a refresh token for the `https://www.googleapis.com/auth/drive.file` scope, for example with the OAuth Playground. A service account won't work: it has no storage quota of its own. `drive.file` only sees files the app created, so let the app create the monthly files in the folder.

### 3. First admin and units

1. Sign in once in the app with the admin's email (this creates the auth user).
2. In the SQL editor: `select promote_admin('admin@example.com', 'שם', 'משפחה', '1234567');`
3. As admin, add the companies and suppliers under "יחידות". The order field sets the order of supplier sections on the customer event screen.
4. The initial catalog goes in later as a new seed migration. The app works with an empty catalog.

### 4. Web hosting

Deploy `web/` as a static site (Vercel, Netlify or Cloudflare Pages): build command `npm run build`, output `dist`, root `web`. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_VAPID_PUBLIC_KEY`. Route every path to `index.html`, since this is a single-page app. Add the site URL under Auth → URL Configuration.

### 5. Keepalive

Add the repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`. `.github/workflows/keepalive.yml` calls the API every 3 days, so a quiet week doesn't pause the free project.

## Tuning values

These live in `app_config` and can change without a deploy:

| Key | Default | Meaning |
| --- | --- | --- |
| `did_you_mean_threshold` | 0.4 | Similarity needed for "התכוונת ל...?" |
| `missing_window_minutes` | 5 | Each missing mark delays the grouped notification this long |
| `missing_window_cap_minutes` | 15 | Latest send time, counted from the first mark |
| `retention_days` | 90 | Age at which events move to Drive |
| `timezone` | Asia/Jerusalem | Resolves "needed by" times |
