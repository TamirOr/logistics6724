-- The spec says a battalion event with an empty list "stays open until its
-- creator or an admin closes it", but only admins could close battalion
-- events. Now: an admin, the event's creator, or a customer of the company
-- of a company event.
create or replace function close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ev events;
begin
  select * into v_ev from events where id = p_event;
  if v_ev.id is null then raise exception 'event not found'; end if;
  if not (is_admin()
          or v_ev.created_by = auth.uid()
          or (my_role() = 'customer' and v_ev.scope = 'company'
              and exists (select 1 from lists where event_id = p_event and company_id = my_unit()))) then
    raise exception 'not allowed to close this event';
  end if;
  update events set status = 'closed', closed_at = now() where id = p_event and status = 'open';
end $$;
