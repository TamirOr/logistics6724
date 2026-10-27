-- A phone's push subscription belongs to whoever is signed in on it. The
-- app upserted push_subscriptions by endpoint, which row-level security
-- refuses when the endpoint belongs to another user, so on a shared phone
-- the previous user's notifications kept arriving. This function moves the
-- endpoint to the caller. The app also deletes it on sign-out.
create function register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from users where id = auth.uid()) then
    raise exception 'sign up first';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;
grant execute on function register_push_subscription to authenticated;
