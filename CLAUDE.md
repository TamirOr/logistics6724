# CLAUDE.md

Battalion logistics requests app. Companies request equipment, suppliers prepare it, both see status live.
The product spec is the source of truth for behavior: https://claude.ai/artifact/6gqAbnwn1YPEQNqroz6oK6

## Principles

1. **Clean code.** Small functions with one job. Delete dead code instead of commenting it out. No leftover debug logging.
2. **Good modeling, easy to maintain.** The data model follows the spec glossary (`unit`, `company`, `supplier`, `event`, `list`, `request`, `item`). Use those exact names for tables, enums, fields, types and components. Business rules live in one place: the database (RLS, triggers, RPCs). The client never re-implements a rule the server enforces. It may only mirror one for optimistic UI.
3. **Human-readable code.** Name things for what they mean in the domain. Write comments for *why*, not *what*. Prefer plain, explicit code over clever code.
4. **No duplicated functions or logic.** Before writing a helper, search for an existing one. Shared code goes in one module and is imported:
   - Hebrew status labels: `supabase/functions/_shared/labels.ts`, used by both web and Edge Functions.
   - Excel columns and row formatting: `supabase/functions/_shared/excel.ts`.
   - All UI strings: `web/src/strings.ts`. No Hebrew literals in components.

## Layout

- `supabase/migrations/`: schema, RLS, business rules, notifications. Migrations are append-only once deployed: add a new file, don't edit an applied one.
- `supabase/functions/`: Deno Edge Functions (`push-dispatch`, `archive`). `_shared/` holds code shared with the web app.
- `supabase/tests/`: SQL tests that run against plain Postgres with a stub of the Supabase auth schema.
- `web/`: Vite + React + TypeScript PWA.

## Commands

- DB tests: `PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh` (needs Postgres 15+ with pg_trgm).
- Web: `cd web && npm run dev | build | typecheck | test`.

## Conventions

- Hebrew UI, `dir="rtl"`. User-entered text uses `dir="auto"`.
- Every permission is enforced with RLS or a guard trigger. Add a SQL test for every new rule.
- Commits use Conventional Commits (`feat(db): …`, `fix(web): …`), one logical change per commit.
