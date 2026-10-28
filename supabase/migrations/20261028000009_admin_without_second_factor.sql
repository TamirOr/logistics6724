-- Admin rights no longer need a TOTP second factor: setting up an
-- authenticator app was too much for this battalion's admins. This is
-- is_admin() as it was before 20261028000002. The admin's sign-in is the
-- email code again, so the mailbox must stay well protected (README,
-- one-time setup: two-factor sign-in on every account).
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'admin', false)
$$;
