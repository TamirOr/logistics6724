-- Security review F9: push endpoints are real push services.
-- push-dispatch POSTs to every stored endpoint from the server, so an
-- arbitrary URL would make it call anywhere. Only the services browsers
-- use: Chrome, Edge, Firefox, Safari. On the table, so direct writes
-- through the push_subscriptions_own policy are covered too.
delete from push_subscriptions where endpoint !~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/';
alter table push_subscriptions add constraint push_subscriptions_endpoint_service check (
  endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/');
