import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** A server-only setting from app_config (cron secret, VAPID keys, site URL). */
export async function serverConfig(db: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await db.rpc("server_config", { k: key });
  if (error) throw error;
  return data;
}

// pg_cron and wake_dispatcher call the functions with app_config.cron_secret.
export async function authorized(req: Request, db: SupabaseClient): Promise<boolean> {
  const secret = await serverConfig(db, "cron_secret");
  return !!secret && req.headers.get("x-cron-secret") === secret;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
