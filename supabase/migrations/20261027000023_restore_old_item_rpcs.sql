-- Migration 20 dropped exact_item and suggest_items when the app moved to
-- match_item. Builds from before that still call them: phones keep their
-- version until the service worker updates, and adding a new item there
-- failed with "Could not find the function public.suggest_items". They are
-- back, unchanged, so the previous build works for one more release
-- (expand, then contract). Drop them in a later release, once the
-- diagnostics of active phones show the new version.

create function exact_item(p_supplier uuid, p_name text)
returns table (id uuid, name text, default_quantity int)
language sql stable set search_path = public as $$
  select i.id, i.name, d.quantity
  from items i
  left join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
  where i.id = find_exact_item(p_supplier, p_name)
$$;
grant execute on function exact_item to authenticated;

create function suggest_items(p_supplier uuid, p_name text)
returns table (id uuid, name text, score real)
language sql stable set search_path = public as $$
  select s.id, s.name, s.similarity from search_items(p_supplier, p_name, 8) s
  where s.similarity >= config('did_you_mean_threshold', '0.4')::real
  order by s.similarity desc limit 3
$$;
grant execute on function suggest_items to authenticated;
