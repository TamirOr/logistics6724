-- Security review F2: admin needs a second factor.
-- An admin approves and moves users and reads all personal data, so the
-- mailbox alone must not be enough. Supabase puts aal2 in the JWT once the
-- user has verified a TOTP code in this session; with aal1 an admin is
-- treated as having no admin rights at all, everywhere is_admin() is used.
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'admin', false) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
