-- The add row called exact_item and then suggest_items: two round trips
-- on a weak signal. match_item answers both in one: the exact match if
-- there is one, otherwise up to 3 "did you mean" suggestions.

create function match_item(p_supplier uuid, p_name text)
returns table (id uuid, name text, exact boolean, default_quantity int)
language plpgsql stable set search_path = public as $$
declare v_exact uuid := find_exact_item(p_supplier, p_name);
begin
  if v_exact is not null then
    return query
      select i.id, i.name, true, d.quantity
      from items i
      left join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
      where i.id = v_exact;
    return;
  end if;
  return query
    select s.id, s.name, false, s.default_quantity
    from search_items(p_supplier, p_name, 8) s
    where s.similarity >= config('did_you_mean_threshold', '0.4')::real
    order by s.similarity desc limit 3;
end $$;
grant execute on function match_item to authenticated;

drop function exact_item(uuid, text);
drop function suggest_items(uuid, text);
