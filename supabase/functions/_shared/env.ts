import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Server-only settings from app_config (cron secret, VAPID keys, site URL), in one query. */
export async function serverConfigs<K extends string>(db: SupabaseClient, keys: K[]): Promise<Record<K, string | undefined>> {
  const { data, error } = await db.rpc("server_configs", { p_keys: keys });
  if (error) throw error;
  return Object.fromEntries((data as { key: K; value: string }[]).map((r) => [r.key, r.value])) as Record<K, string | undefined>;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
