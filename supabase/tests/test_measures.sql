-- Measures on requests: cleaned and spelled like the item's existing ones,
-- collected per item for the add row, fixed once the request exists.
-- Runs after test_flows.sql and uses its users and items.
set client_min_messages = warning;
set role authenticated;

select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'm_ev', create_event('אימון מים', 'company');
insert into tst.t select 'm_list', id from lists where event_id = (select v from tst.t where k = 'm_ev');
insert into tst.t select 'm_jerry', id from items where name = 'ג׳ריקן מים';

-- A new measure is cleaned and joins the item's measures.
insert into requests (id, list_id, item_id, quantity, measure) values
  ('30000000-0000-0000-0000-000000000001', (select v from tst.t where k = 'm_list'), (select v from tst.t where k = 'm_jerry'), 20, '  ליטר   מים ');
select tst.ok(measure = 'ליטר מים', 'measure is trimmed') from requests where id = '30000000-0000-0000-0000-000000000001';
select tst.ok((select array_agg(name) from item_measures where item_id = (select v from tst.t where k = 'm_jerry')) = '{ליטר מים}',
  'a new measure joins the item');
select tst.ok((select measure from default_quantities where company_id = '00000000-0000-0000-0000-0000000000c1'
                 and item_id = (select v from tst.t where k = 'm_jerry')) = 'ליטר מים', 'the company''s last measure is remembered');

-- The plural of an existing measure is the same measure.
insert into requests (id, list_id, item_id, quantity, measure) values
  ('30000000-0000-0000-0000-000000000002', (select v from tst.t where k = 'm_list'), (select v from tst.t where k = 'm_jerry'), 2, 'ליטרים מים');
select tst.ok(measure = 'ליטר מים', 'a plural takes the existing spelling') from requests where id = '30000000-0000-0000-0000-000000000002';
select tst.ok((select count(*) from item_measures where item_id = (select v from tst.t where k = 'm_jerry')) = 1,
  'no duplicate measure');

insert into requests (id, list_id, item_id, quantity, measure) values
  ('30000000-0000-0000-0000-000000000003', (select v from tst.t where k = 'm_list'), (select id from items where name = 'סוללה AA'), 4, ' ');
select tst.ok(measure is null, 'a blank measure is no measure') from requests where id = '30000000-0000-0000-0000-000000000003';
select tst.ok(not exists (select 1 from item_measures m join items i on i.id = m.item_id where i.name = 'סוללה AA'),
  'no measure adds nothing to the item');
insert into requests (id, list_id, item_id, quantity, measure) values
  ('30000000-0000-0000-0000-000000000004', (select v from tst.t where k = 'm_list'), (select v from tst.t where k = 'm_jerry'), 1, 'קרטון');

-- The add row gets the measures from search and match.
select tst.ok(measures = '{ליטר מים,קרטון}' and default_measure = 'קרטון', 'search returns measures and the last one')
from search_catalog('00000000-0000-0000-0000-0000000000a1', 'גריקן') where id = (select v from tst.t where k = 'm_jerry');
select tst.ok(measures = '{ליטר מים,קרטון}' and default_measure = 'קרטון', 'exact match returns measures')
from match_catalog('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקן מים');
select tst.ok(default_measure = 'קרטון', 'the empty search returns the last measure')
from search_catalog('00000000-0000-0000-0000-0000000000a1', '') where id = (select v from tst.t where k = 'm_jerry');
select tst.ok((select default_quantity from search_items('00000000-0000-0000-0000-0000000000a1', 'גריקן')
                 where id = (select v from tst.t where k = 'm_jerry')) = 1, 'the previous build''s search still answers');
select tst.ok((select exact from match_item('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקן מים')), 'the previous build''s match still answers');
select tst.ok((select measure from export_rows where item_name = 'ג׳ריקן מים' and event_id = (select v from tst.t where k = 'm_ev')
                 order by quantity limit 1) = 'קרטון', 'export rows carry the measure');

-- Another company sees the item's measures, not this company's default.
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.ok(measures = '{ליטר מים,קרטון}' and default_measure is null, 'measures are shared, the default is per company')
from search_catalog('00000000-0000-0000-0000-0000000000a1', 'גריקן') where id = (select v from tst.t where k = 'm_jerry');

-- Should fail: changing a measure, writing measures directly, an oversized one.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$update requests set measure = 'קרטון' where id = '30000000-0000-0000-0000-000000000001'$$,
  'customer cannot change a measure');
select tst.fails($$insert into item_measures (item_id, name) values ((select v from tst.t where k = 'm_jerry'), 'משטח')$$,
  'customer cannot write item measures');
select tst.fails($$insert into requests (list_id, item_id, quantity, measure)
  values ((select v from tst.t where k = 'm_list'), (select v from tst.t where k = 'm_jerry'), 1, repeat('א', 31))$$,
  'measure is at most 30 characters');
update requests set quantity = 21 where id = '30000000-0000-0000-0000-000000000001';
select tst.ok(measure = 'ליטר מים', 'a quantity change keeps the measure') from requests where id = '30000000-0000-0000-0000-000000000001';
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails($$update requests set measure = 'קרטון' where id = '30000000-0000-0000-0000-000000000001'$$,
  'supplier cannot change a measure');
select tst.fails($$delete from item_measures$$, 'supplier cannot delete item measures directly');
select tst.ok((select count(*) from item_measures where item_id = (select v from tst.t where k = 'm_jerry')) = 2,
  'item measures are unchanged');

-- Duplicating an event copies the measures.
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'm_ev2', duplicate_event((select v from tst.t where k = 'm_ev'), 'אימון מים 2');
select tst.ok((select array_agg(measure order by measure) from requests where event_id = (select v from tst.t where k = 'm_ev2')
                 and measure is not null) = '{ליטר מים,ליטר מים,קרטון}', 'duplicate copies measures');

-- A merge moves the measures to the item it merges into.
insert into tst.t select 'm_bottle', add_item('00000000-0000-0000-0000-0000000000a1', 'בקבוק מים מינרליים');
insert into requests (list_id, item_id, quantity, measure)
values ((select v from tst.t where k = 'm_list'), (select v from tst.t where k = 'm_bottle'), 6, 'שישייה');
select tst.act('10000000-0000-0000-0000-000000000004');
select merge_item((select v from tst.t where k = 'm_bottle'), (select v from tst.t where k = 'm_jerry'));
select tst.ok((select array_agg(name order by name) from item_measures where item_id = (select v from tst.t where k = 'm_jerry'))
  = '{ליטר מים,קרטון,שישייה}', 'merge moves the measures');
select tst.ok((select measure from requests where item_id = (select v from tst.t where k = 'm_jerry') and quantity = 6) = 'שישייה',
  'merged requests keep their measure');

-- Leave the shared fixtures as the later test files expect them.
select tst.act('10000000-0000-0000-0000-000000000002');
select cancel_event(v) from tst.t where k in ('m_ev', 'm_ev2');
reset role;
