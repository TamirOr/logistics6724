-- After a restore drill: removes the restored production data from staging.
-- Staging's settings stay; seed-staging loads the fake units and catalog again.
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
             and not (schemaname = 'public' and tablename = 'app_config')
  loop
    execute format('delete from %I.%I', t.schemaname, t.tablename);
  end loop;
end $$;
set session_replication_role = origin;
