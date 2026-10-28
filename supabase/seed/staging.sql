-- Fake units and catalog for the staging project. Never run on production
-- (seed-staging refuses unless DEPLOY_TARGET=staging). Safe to run again.
-- Users sign up through the app with test addresses and an admin approves them.
insert into units (name, kind, headcount) values
  ('פלוגת בדיקה א', 'company', 90),
  ('פלוגת בדיקה ב', 'company', 75),
  ('פלוגת בדיקה ג', 'company', null)
on conflict (kind, name) do nothing;

insert into units (name, kind) values
  ('אפסנאות (בדיקה)', 'supplier'),
  ('מטבח (בדיקה)', 'supplier')
on conflict (kind, name) do nothing;

insert into items (supplier_id, name, verified)
select u.id, item.name, true
from units u
join (values
  ('אפסנאות (בדיקה)', 'ג׳ריקן מים'),
  ('אפסנאות (בדיקה)', 'סוללה AA'),
  ('אפסנאות (בדיקה)', 'פנס ראש'),
  ('אפסנאות (בדיקה)', 'שק שינה'),
  ('מטבח (בדיקה)', 'ארגז מנות קרב'),
  ('מטבח (בדיקה)', 'שישיית מים'),
  ('מטבח (בדיקה)', 'קפה שחור')
) as item (supplier, name) on item.supplier = u.name and u.kind = 'supplier'
where not exists (select 1 from items i where i.supplier_id = u.id and i.name = item.name);
