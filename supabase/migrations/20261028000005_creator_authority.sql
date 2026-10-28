-- Security review F8: a creator's authority ends with their access.
-- The creator branch checked only created_by, so a deactivated user, or one
-- moved to another unit, could still close or cancel their old events with a
-- live session. Now the creator must still be approved, active and in the
-- unit the event was created for (my_unit() is null otherwise).
create or replace function close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ev events;
begin
  select * into v_ev from events where id = p_event;
  if v_ev.id is null then raise exception 'event not found'; end if;
  if not (is_admin()
          -- coalesce: with my_unit() null the comparison is null, and
          -- "if not (null)" would let the call through.
          or coalesce(v_ev.created_by = auth.uid() and v_ev.created_by_unit = my_unit(), false)
          or (my_role() = 'customer' and v_ev.scope = 'company'
              and exists (select 1 from lists where event_id = p_event and company_id = my_unit()))) then
    raise exception 'not allowed to close this event';
  end if;
  update events set status = 'closed', closed_at = now() where id = p_event and status = 'open';
end $$;

create or replace function cancel_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or exists (select 1 from events where id = p_event
                                and created_by = auth.uid() and created_by_unit = my_unit())) then
    raise exception 'not allowed to cancel this event';
  end if;
  update events set status = 'cancelled', cancelled_at = now() where id = p_event and status <> 'cancelled';
end $$;
