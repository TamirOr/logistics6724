-- Called by the GitHub keepalive workflow with the anon key. A query is
-- enough for the free project to count as active, and this exposes nothing.
create function keepalive() returns timestamptz
language sql stable as $$ select now() $$;
revoke execute on function keepalive from public;
grant execute on function keepalive to anon, authenticated;
