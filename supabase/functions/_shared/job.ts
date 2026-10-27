// The frame every scheduled function runs in: checks the cron secret, times
// the run, reports errors to Sentry, logs one JSON line and records the run
// in job_runs, which the health check reads. Supabase keeps function logs
// only briefly on the free plan; job_runs keeps 30 days.
import * as Sentry from "npm:@sentry/deno@11.9.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { json, serverConfigs, serviceClient } from "./env.ts";
import { authorized } from "./secrets.ts";

/** Counts for the log line and job_runs (claimed, sent, failed...). Never names or message text. */
export type JobSummary = Record<string, number | boolean>;

export interface JobOutcome {
  summary: JobSummary;
  /** Set when the run did not do all its work. The run is then recorded as failed. */
  error?: string;
}

const VERSION = Deno.env.get("APP_VERSION") ?? "dev";

function initSentry(job: string) {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return;
  // Default integrations patch Deno.serve, which the Edge runtime does not allow.
  Sentry.init({
    dsn,
    release: VERSION,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
    defaultIntegrations: false,
  });
  Sentry.setTag("fn", job);
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

async function record(db: SupabaseClient, job: string, startedAt: Date, outcome: JobOutcome) {
  const { error } = await db.from("job_runs").insert({
    job, started_at: startedAt.toISOString(), ok: !outcome.error, summary: outcome.summary, error: outcome.error ?? null,
  });
  if (error) Sentry.captureException(error);
}

/**
 * Serves a scheduled function. `run` gets a service-role client and the
 * server settings it asked for (the cron secret is always read).
 */
export function serveJob<K extends string>(
  job: string,
  configKeys: K[],
  run: (db: SupabaseClient, config: Record<K, string | undefined>) => Promise<JobOutcome>,
) {
  initSentry(job);
  Deno.serve(async (req) => {
    const startedAt = new Date();
    const runId = crypto.randomUUID();
    const db = serviceClient();
    let outcome: JobOutcome;
    try {
      const config = await serverConfigs(db, ["cron_secret", ...configKeys]);
      if (!authorized(req, config.cron_secret)) return json({ error: "unauthorized" }, 401);
      outcome = await run(db, config as Record<K, string | undefined>);
      if (outcome.error) Sentry.captureMessage(`${job}: ${outcome.error}`, "error");
    } catch (e) {
      Sentry.captureException(e);
      outcome = { summary: {}, error: messageOf(e) };
    }
    console.log(JSON.stringify({
      fn: job, version: VERSION, run_id: runId, duration_ms: Date.now() - startedAt.getTime(),
      ...outcome.summary, error: outcome.error ?? null,
    }));
    await record(db, job, startedAt, outcome);
    await Sentry.flush(2000);
    return json({ ...outcome.summary, error: outcome.error ?? null }, outcome.error ? 500 : 200);
  });
}
