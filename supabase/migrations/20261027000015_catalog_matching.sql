-- Catalog matching:
-- * A supplier's active item names are unique once normalized. Two
--   customers adding the same new name at once used to create two items.
-- * add_item no longer duplicates a hidden item: a supplier adding its
--   name unhides it, a customer is told it is hidden.
-- * exact_item gives the app the server's normalized exact match, so "did
--   you mean" is skipped when the typed name already exists.
-- * search_items reports the plain word similarity next to its ranking
--   score, and the "did you mean" threshold applies to that, not to a
--   score that includes prefix boosts.

-- The merge itself, without the permission check, so this migration can
-- use it too. merge_item keeps the check.
create function merge_items(p_source uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_src items; v_dst items;
begin
  select * into v_src from items where id = p_source;
  select * into v_dst from items where id = p_target;
  if v_src.id is null or v_dst.id is null or p_source = p_target then raise exception 'invalid merge'; end if;
  if v_src.supplier_id <> v_dst.supplier_id then raise exception 'items belong to different suppliers'; end if;

  update requests set item_id = p_target where item_id = p_source;

  insert into default_quantities (company_id, item_id, quantity, updated_at)
  select company_id, p_target, quantity, updated_at from default_quantities where item_id = p_source
  on conflict (company_id, item_id) do update
    set quantity = excluded.quantity, updated_at = excluded.updated_at
    where default_quantities.updated_at < excluded.updated_at;

  insert into item_aliases (item_id, alias)
  select p_target, a.alias from item_aliases a where a.item_id = p_source
  union select p_target, v_src.name
  on conflict do nothing;

  delete from items where id = p_source;
end $$;

create or replace function merge_item(p_source uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from items where id = p_source and supplier_id = my_unit())
     or my_role() is distinct from 'supplier' then
    raise exception 'not your catalog';
  end if;
  perform merge_items(p_source, p_target);
  update items set verified = true where id = p_target;
end $$;

-- Merge active duplicates that already exist into the oldest verified one.
do $$
declare d record;
begin
  for d in
    select id, first_value(id) over w as keeper
    from items where active
    window w as (partition by supplier_id, name_norm order by verified desc, created_at, id)
  loop
    if d.id <> d.keeper then perform merge_items(d.id, d.keeper); end if;
  end loop;
end $$;

create unique index items_active_name_unique on items (supplier_id, name_norm) where active;

-- The active item whose normalized name or alias equals the given name,
-- with this company's default quantity.
create function exact_item(p_supplier uuid, p_name text)
returns table (id uuid, name text, default_quantity int)
language sql stable set search_path = public as $$
  select i.id, i.name, d.quantity
  from items i
  left join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
  where i.id = find_exact_item(p_supplier, p_name)
$$;
grant execute on function exact_item to authenticated;
grant execute on function find_exact_item to authenticated;

create or replace function add_item(p_supplier uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := my_role();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not exists (select 1 from units where id = p_supplier and kind = 'supplier' and active) then
    raise exception 'not a supplier';
  end if;
  if not (v_role = 'customer' or (v_role = 'supplier' and p_supplier = my_unit())) then
    raise exception 'not allowed to add items here';
  end if;
  if v_name = '' then raise exception 'empty name'; end if;

  v_id := find_exact_item(p_supplier, v_name);
  if v_id is not null then return v_id; end if;

  -- A hidden item with this name: the supplier brings it back, a customer
  -- may not, since the supplier hid it on purpose.
  select id into v_id from items
  where supplier_id = p_supplier and not active and name_norm = normalize_he(v_name)
  order by verified desc, created_at limit 1;
  if v_id is not null then
    if v_role <> 'supplier' then raise exception 'item is hidden by the supplier'; end if;
    update items set active = true where id = v_id;
    return v_id;
  end if;

  begin
    insert into items (supplier_id, name, verified, created_by)
    values (p_supplier, v_name, v_role = 'supplier', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- Someone added the same name a moment ago.
    v_id := find_exact_item(p_supplier, v_name);
  end;
  return v_id;
end $$;

-- search_items gains a column, which needs a drop. suggest_items calls it.
drop function suggest_items(uuid, text);
drop function search_items(uuid, text, int);

-- Autocomplete over names and aliases, at most 8 rows. score ranks the
-- results (prefix matches first); similarity is the plain word similarity.
-- With an empty query, returns the items this company requested most
-- recently.
create function search_items(p_supplier uuid, p_q text, p_limit int default 8)
returns table (id uuid, name text, verified boolean, matched_alias text, score real, similarity real, default_quantity int)
language plpgsql stable set search_path = public, extensions set pg_trgm.word_similarity_threshold = 0.3 as $$
declare q text := normalize_he(coalesce(p_q, ''));
begin
  if q = '' then
    return query
      select i.id, i.name, i.verified, null::text, 1::real, 1::real, d.quantity
      from items i
      join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
      where i.supplier_id = p_supplier and i.active
      order by d.updated_at desc limit p_limit;
    return;
  end if;

  return query
  with cand as (
    select i.id, i.name, i.verified, null::text as alias,
      word_similarity(q, i.name_norm) as sim,
      case when i.name_norm like escape_like_pattern(q) || '%' then 0.5
           when i.name_norm like '% ' || escape_like_pattern(q) || '%' then 0.3 else 0 end as boost
    from items i
    where i.supplier_id = p_supplier and i.active
      and (q <% i.name_norm or i.name_norm like '%' || escape_like_pattern(q) || '%')
    union all
    select i.id, i.name, i.verified, a.alias,
      word_similarity(q, a.alias_norm),
      case when a.alias_norm like escape_like_pattern(q) || '%' then 0.5 else 0 end
    from item_aliases a join items i on i.id = a.item_id
    where i.supplier_id = p_supplier and i.active
      and (q <% a.alias_norm or a.alias_norm like '%' || escape_like_pattern(q) || '%')
  ), best as (
    select distinct on (c.id) c.id, c.name, c.verified, c.alias, c.sim, c.sim + c.boost as s
    from cand c order by c.id, c.sim + c.boost desc
  )
  select b.id, b.name, b.verified, b.alias, b.s::real, b.sim::real, d.quantity
  from best b
  left join default_quantities d on d.item_id = b.id and d.company_id = my_unit()
  order by b.s desc, b.name
  limit p_limit;
end $$;
grant execute on function search_items to authenticated;

-- "התכוונת ל...?": up to 3 items whose word similarity reaches the threshold.
create function suggest_items(p_supplier uuid, p_name text)
returns table (id uuid, name text, score real)
language sql stable as $$
  select s.id, s.name, s.similarity from search_items(p_supplier, p_name, 8) s
  where s.similarity >= config('did_you_mean_threshold', '0.4')::real
  order by s.similarity desc limit 3
$$;
grant execute on function suggest_items to authenticated;
