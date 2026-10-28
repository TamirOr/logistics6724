-- The battalion's units and catalog from the seed migrations. Runs before the
-- test_*.sql files, which then start from an empty roster of their own.
set client_min_messages = warning;
create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;

select pg_temp.ok((select count(*) from units where kind = 'company') = 5, 'five companies');
select pg_temp.ok((select count(*) from units where kind = 'supplier') = 8, 'seven logistic platoons and the kitchen');

create temp view seeded as
  select u.name as supplier, i.name, i.category from items i join units u on u.id = i.supplier_id;
select pg_temp.ok((select count(*) from seeded where supplier = 'נשקיה') = 1, 'sight batteries come from נשקיה');
select pg_temp.ok((select count(*) from seeded where supplier = 'מטבח') = 62, 'food, drinks and kitchen supplies come from the kitchen');
select pg_temp.ok((select array_agg(distinct category) from seeded where supplier = 'אפסנאות') = array['ניקיון והיגיינה', 'סוללות'],
  'אפסנאות keeps cleaning supplies and batteries');
select pg_temp.ok((select count(*) from items where category is null) = 0, 'every seeded item has a category');
select pg_temp.ok((select count(*) from items where name ~ '[–•]') = 0, 'no list punctuation in item names');
select pg_temp.ok((select array_agg(m.name order by m.name) from item_measures m join items i on i.id = m.item_id
  where i.name = 'כוסות חמות') = array['קרטון'], 'hot cups come in cartons, after the move too');

-- What the move leaves under אפסנאות: an item a supplier added, and one the
-- kitchen already has. Running it again moves nothing else.
insert into auth.users (id, email) values ('20000000-0000-0000-0000-000000000001', 'admin@x.il');
insert into users (id, email, first_name, last_name, service_number, role, approval)
values ('20000000-0000-0000-0000-000000000001', 'admin@x.il', 'א', 'ב', '1234567', 'admin', 'approved');
insert into items (supplier_id, name, category, verified, created_by)
select id, 'קפה שחור', 'שתייה', true, '20000000-0000-0000-0000-000000000001' from units where name = 'אפסנאות';
insert into items (supplier_id, name, category, verified)
select id, 'עגבנייה', 'ירקות', true from units where name = 'אפסנאות';
\ir ../migrations/20261028000019_kitchen_catalog.sql
select pg_temp.ok((select count(*) from seeded where supplier = 'אפסנאות' and name in ('קפה שחור', 'עגבנייה')) = 2,
  'a supplier''s own item and a name the kitchen has stay');
select pg_temp.ok((select count(*) from seeded where supplier = 'מטבח') = 62, 'running it again moves nothing else');

truncate units, users cascade;
delete from auth.users;
