-- Restore drill, part 1 of 3. psql runs prepare.sql, the backup's data.sql
-- and finish.sql in one transaction against the staging project, so a
-- failure leaves staging as it was. Triggers stay off while rows load.
set session_replication_role = replica;

-- Staging keeps its own settings: production's would point its jobs at
-- production's functions and sign pushes with production's keys.
create temp table staging_config on commit drop as select * from public.app_config;

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
