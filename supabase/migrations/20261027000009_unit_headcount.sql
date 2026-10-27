-- Companies record their headcount (סד״כ). Suppliers have none. Supplier
-- sections and companies are listed alphabetically, so the manual order
-- field is no longer used.
alter table units drop column sort_order;
alter table units add column headcount int check (headcount >= 0);
alter table units add constraint units_headcount_companies_only check (kind = 'company' or headcount is null);
