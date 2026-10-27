// Sends pending Web Push notifications. Runs every minute from pg_cron,
// and right away when a notification is queued (see wake_dispatcher).
import webpush from "npm:web-push@3.6.7";
import { authorized, json, serverConfigs, serviceClient } from "../_shared/env.ts";
import { APP_NAME } from "../_shared/labels.ts";

interface Subscription { subscription_id: string; endpoint: string; p256dh: string; auth: string }

/** "delivered", "gone" when the browser dropped the subscription, or the error to retry on. */
async function sendTo(s: Subscription, payload: string): Promise<"delivered" | "gone" | string> {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
      { TTL: 60 * 60 * 6, urgency: "high" },
    );
    return "delivered";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : `${status ?? ""} ${(e as Error).message}`;
  }
}

Deno.serve(async (req) => {
  const db = serviceClient();
  const config = await serverConfigs(db, ["cron_secret", "site_url", "vapid_public_key", "vapid_private_key"]);
  if (!authorized(req, config.cron_secret)) return json({ error: "unauthorized" }, 401);

  // The deploy workflow generates the keys and stores them in app_config.
  // The subject identifies the sender to push services; the site URL does.
  webpush.setVapidDetails(config.site_url ?? "mailto:admin@example.invalid", config.vapid_public_key!, config.vapid_private_key!);

  const { error: flushError } = await db.rpc("flush_missing_queue");
  if (flushError) console.error("flush_missing_queue", flushError);

  const { data: rows, error } = await db.rpc("claim_outbox", { p_limit: 100 });
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const row of rows ?? []) {
    const { data: subs, error: subsError } = await db.rpc("outbox_subscriptions", { p_outbox: row.id });
    if (subsError) {
      await db.rpc("release_outbox", { p_id: row.id, p_error: subsError.message });
      continue;
    }
    const payload = JSON.stringify({ title: APP_NAME, body: row.body, url: row.url ?? "/", tag: row.kind });
    // All of a notification's devices at once; a battalion event reaches every customer.
    const results = await Promise.all((subs as Subscription[] ?? []).map((s) => sendTo(s, payload)));

    const gone = (subs as Subscription[]).filter((_, i) => results[i] === "gone").map((s) => s.subscription_id);
    if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);

    const delivered = results.filter((r) => r === "delivered").length;
    const transientError = results.find((r) => r !== "delivered" && r !== "gone");
    sent += delivered;
    // Retry only if no device got it, so nobody sees it twice. A row with no
    // subscriptions to reach counts as done.
    if (transientError && delivered === 0) {
      await db.rpc("release_outbox", { p_id: row.id, p_error: transientError });
    } else {
      await db.rpc("mark_outbox_sent", { p_id: row.id });
    }
  }
  return json({ claimed: rows?.length ?? 0, sent });
});
