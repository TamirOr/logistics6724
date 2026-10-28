// Sends pending Web Push notifications. Runs right away when a
// notification is queued (see wake_dispatcher), from pg_cron in any minute
// with a retry or grouped notification due (dispatch_due), and hourly.
import webpush from "npm:web-push@3.6.7";
import { serveJob } from "../_shared/job.ts";
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

serveJob("push-dispatch", ["site_url", "vapid_public_key", "vapid_private_key"], async (db, config) => {
  // The deploy workflow generates the keys and stores them in app_config.
  // The subject identifies the sender to push services; the site URL does.
  webpush.setVapidDetails(config.site_url ?? "mailto:admin@example.invalid", config.vapid_public_key!, config.vapid_private_key!);

  // A failed flush delays grouped "missing" notifications; the rest still go out.
  const { error: flushError } = await db.rpc("flush_missing_queue");

  const { data: rows, error } = await db.rpc("claim_outbox", { p_limit: 100 });
  if (error) throw error;

  const summary = { claimed: rows?.length ?? 0, sent: 0, failed: 0, removed: 0 };
  for (const row of rows ?? []) {
    const { data: subs, error: subsError } = await db.rpc("outbox_subscriptions", { p_outbox: row.id });
    if (subsError) {
      await db.rpc("release_outbox", { p_id: row.id, p_error: subsError.message });
      continue;
    }
    const payload = JSON.stringify({ title: APP_NAME, body: row.body, url: row.url ?? "/", tag: row.kind });
    // All of a notification's devices at once; a battalion event reaches every customer.
    const targets = (subs ?? []) as Subscription[];
    const results = await Promise.all(targets.map((s) => sendTo(s, payload)));
    const idsWhere = (outcome: (r: string) => boolean) =>
      targets.filter((_, i) => outcome(results[i])).map((s) => s.subscription_id);

    const gone = idsWhere((r) => r === "gone");
    if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);
    const delivered = idsWhere((r) => r === "delivered");
    if (delivered.length) {
      await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).in("id", delivered);
    }

    const transientError = results.find((r) => r !== "delivered" && r !== "gone");
    summary.sent += delivered.length;
    summary.removed += gone.length;
    summary.failed += results.length - delivered.length - gone.length;
    // Retry only if no device got it, so nobody sees it twice. A row with no
    // subscriptions to reach counts as done.
    if (transientError && delivered.length === 0) {
      await db.rpc("release_outbox", { p_id: row.id, p_error: transientError });
    } else {
      await db.rpc("mark_outbox_sent", { p_id: row.id });
    }
  }
  return { summary, error: flushError ? `flush_missing_queue: ${flushError.message}` : undefined };
});
