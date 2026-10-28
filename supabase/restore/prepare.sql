-- Empties the public and auth schemas before a backup's data.sql loads.
-- psql runs prepare.sql and data.sql in one transaction, so a failure
-- leaves the database as it was. Used by the restore drill (a throwaway
-- database in the runner) and by disaster recovery (docs/runbook.md).
-- Triggers stay off while rows load.
set session_replication_role = replica;

-- Delete rather than truncate: on Supabase the postgres role may delete
-- from the auth tables but does not own them. With triggers off, the order
-- does not matter.
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables
           where schemaname in ('public', 'auth')
             and not (schemaname = 'auth' and tablename = 'schema_migrations')
  loop
    execute format('delete from %I.%I', t.schemaname, t.tablename);
  end loop;
end $$;
