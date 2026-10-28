-- Supabase creates rls_auto_enable() in public on newer projects: the event
-- trigger function behind "enable RLS on new tables". The default privileges
-- let anon and authenticated execute it, which privilege_drift() reports.
-- Nothing in the app calls it, and an event trigger runs without the grant.
-- Projects created without it have nothing to revoke.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
  end if;
end $$;
