-- Food, drinks and kitchen supplies come from the kitchen (מטבח), not from
-- אפסנאות, which keeps cleaning supplies and batteries. Adds the kitchen and
-- moves there the items 20261028000016 seeded under אפסנאות in those
-- categories.
--
-- A request copies its item's supplier, so an item already requested stays
-- where it is: moving it would split its requests from their supplier. So
-- does an item the kitchen already has under the same name. Items suppliers
-- added themselves (they have a creator) are theirs and are not touched.

insert into units (name, kind) values ('מטבח', 'supplier')
on conflict (kind, name) do nothing;

update items i set supplier_id = kitchen.id
from units store, units kitchen
where store.name = 'אפסנאות' and store.kind = 'supplier'
  and kitchen.name = 'מטבח' and kitchen.kind = 'supplier'
  and i.supplier_id = store.id
  and i.created_by is null
  and i.category in ('ירקות', 'פירות', 'מוצרי חלב', 'רטבים וממרחים', 'מוצרים יבשים', 'תבלינים', 'שתייה', 'חד פעמי וציוד מטבח')
  and not exists (select 1 from requests r where r.item_id = i.id)
  and not exists (select 1 from items k where k.supplier_id = kitchen.id and k.name_norm = i.name_norm);
