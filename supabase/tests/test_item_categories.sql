-- Item categories: optional, cleaned and spelled like the supplier's
-- existing ones, set by the supplier on its own catalog, given by a customer
-- only when they add a new item. Runs after test_flows.sql and uses its
-- users: 05 is the kitchen's (a2) supplier, 04 the store's (a1).
set client_min_messages = warning;
set role authenticated;

-- The kitchen sets up its catalog with categories.
select tst.act('10000000-0000-0000-0000-000000000005');
insert into tst.t select 'c_tomato', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'עגבניה', '  ירקות   ופירות ');
insert into tst.t select 'c_milk', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'חלב', 'מוצרי חלב');
insert into tst.t select 'c_salt', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'מלח');
select tst.ok(category = 'ירקות ופירות', 'category is trimmed') from items where id = (select v from tst.t where k = 'c_tomato');
select tst.ok(category is null, 'an item may have no category') from items where id = (select v from tst.t where k = 'c_salt');

-- Another spelling of an existing category joins it.
update items set category = 'ירק ופירות' where id = (select v from tst.t where k = 'c_salt');
select tst.ok(category = 'ירקות ופירות', 'a variant takes the existing spelling') from items where id = (select v from tst.t where k = 'c_salt');
update items set category = 'תבלינים' where id = (select v from tst.t where k = 'c_salt');
select tst.ok(category = 'תבלינים', 'supplier changes a category') from items where id = (select v from tst.t where k = 'c_salt');
update items set category = ' ' where id = (select v from tst.t where k = 'c_salt');
select tst.ok(category is null, 'a blank category is no category') from items where id = (select v from tst.t where k = 'c_salt');
select tst.ok((select array_agg(c) from supplier_categories('00000000-0000-0000-0000-0000000000a2') c) = '{ירקות ופירות,מוצרי חלב}',
  'the supplier''s categories, alphabetically');

-- A customer gives a category to a new item only; a known item keeps its own.
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'c_orange', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'תפוז', 'ירקות  ופירות');
select tst.ok(category = 'ירקות ופירות', 'customer''s new item joins the existing category')
from items where id = (select v from tst.t where k = 'c_orange');
select tst.ok(add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'חלב', 'משקאות') = (select v from tst.t where k = 'c_milk'),
  'a known item is reused');
select tst.ok(category = 'מוצרי חלב', 'a known item keeps its category') from items where id = (select v from tst.t where k = 'c_milk');
select tst.ok(category is null, 'the previous build''s call adds an item without a category')
from items where id = add_item(p_supplier => '00000000-0000-0000-0000-0000000000a2', p_name => 'שמן');

-- Export rows carry the category.
insert into tst.t select 'c_ev', create_event('ארוחת ערב', 'company');
insert into requests (list_id, item_id, quantity)
select l.id, i.v, 3 from lists l, tst.t i
where l.event_id = (select v from tst.t where k = 'c_ev') and i.k in ('c_tomato', 'c_salt');
select tst.ok((select array_agg(item_category order by item_name) from export_rows where event_id = (select v from tst.t where k = 'c_ev'))
  = '{NULL,ירקות ופירות}', 'export rows carry the category');

-- Should fail: a customer or another supplier changes a category, an oversized one.
update items set category = 'משקאות' where id = (select v from tst.t where k = 'c_milk');
select tst.act('10000000-0000-0000-0000-000000000004');
update items set category = 'משקאות' where id = (select v from tst.t where k = 'c_milk');
select tst.ok(category = 'מוצרי חלב', 'only the item''s supplier changes its category')
from items where id = (select v from tst.t where k = 'c_milk');
select tst.act('10000000-0000-0000-0000-000000000005');
select tst.fails($$update items set category = repeat('א', 31) where id = (select v from tst.t where k = 'c_milk')$$,
  'category is at most 30 characters');

-- A merge keeps the target's category, or takes the source's if it had none.
select merge_item((select v from tst.t where k = 'c_orange'), (select v from tst.t where k = 'c_salt'));
select tst.ok(category = 'ירקות ופירות', 'merge into an item without a category takes the source''s')
from items where id = (select v from tst.t where k = 'c_salt');
insert into tst.t select 'c_milk2', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'חלב עמיד', 'משקאות');
select merge_item((select v from tst.t where k = 'c_milk2'), (select v from tst.t where k = 'c_milk'));
select tst.ok(category = 'מוצרי חלב', 'merge keeps the target''s category') from items where id = (select v from tst.t where k = 'c_milk');

-- A customer fills in a missing category, spelled like the supplier's.
insert into tst.t select 'c_flour', add_catalog_item('00000000-0000-0000-0000-0000000000a2', 'קמח');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(add_item_category(v, 'ירק ופירות') = 'ירקות ופירות', 'add_item_category returns the stored spelling')
from tst.t where k = 'c_flour';
select tst.ok(category = 'ירקות ופירות', 'customer adds a category to an item that has none')
from items where id = (select v from tst.t where k = 'c_flour');

-- Should fail: a customer replaces a category, a blank one, a supplier calls it.
select tst.fails($$select add_item_category((select v from tst.t where k = 'c_flour'), 'תבלינים')$$,
  'customer replaces an existing category');
select tst.fails($$select add_item_category((select v from tst.t where k = 'c_flour'), '  ')$$,
  'customer adds a blank category');
select tst.act('10000000-0000-0000-0000-000000000005');
update items set category = null where id = (select v from tst.t where k = 'c_flour');
select tst.fails($$select add_item_category((select v from tst.t where k = 'c_flour'), 'תבלינים')$$,
  'add_item_category is for customers');

-- Leave the shared fixtures as the later test files expect them.
select tst.act('10000000-0000-0000-0000-000000000002');
select cancel_event(v) from tst.t where k = 'c_ev';
reset role;
