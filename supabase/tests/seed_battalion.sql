-- The battalion's units and catalog from the seed migration. Runs before the
-- test_*.sql files, which then start from an empty roster of their own.
set client_min_messages = warning;
create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;

select pg_temp.ok((select count(*) from units where kind = 'company') = 5, 'five companies');
select pg_temp.ok((select count(*) from units where kind = 'supplier') = 7, 'seven logistic platoons');
select pg_temp.ok((select count(*) from items i join units u on u.id = i.supplier_id where u.name = 'נשקיה') = 1,
  'sight batteries come from נשקיה');
select pg_temp.ok((select count(*) from items where category is null) = 0, 'every seeded item has a category');
select pg_temp.ok((select count(*) from items where name ~ '[–•]') = 0, 'no list punctuation in item names');
select pg_temp.ok((select array_agg(m.name order by m.name) from item_measures m join items i on i.id = m.item_id
  where i.name = 'כוסות חמות') = array['קרטון'], 'hot cups come in cartons');

-- Running it again on a database that has the data adds nothing.
create temp table before as
  select (select count(*) from units) as units, (select count(*) from items) as items, (select count(*) from item_measures) as measures;
\ir ../migrations/20261028000016_battalion_units_and_catalog.sql
select pg_temp.ok((select count(*) from units) = units and (select count(*) from items) = items
  and (select count(*) from item_measures) = measures, 'seed is safe to run again') from before;

-- An item already in the catalog under another spelling is kept, not doubled.
delete from items where name = 'לימון';
insert into items (supplier_id, name, verified) select id, 'לימונים', true from units where name = 'אפסנאות';
\ir ../migrations/20261028000016_battalion_units_and_catalog.sql
select pg_temp.ok((select count(*) from items where name in ('לימון', 'לימונים')) = 1, 'existing spelling is kept');

truncate units cascade;
