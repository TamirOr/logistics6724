import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

// Scheduled jobs call the functions with the shared secret stored in
// app_config.cron_secret and in the CRON_SECRET function secret.
export function authorized(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  return !!secret && req.headers.get("x-cron-secret") === secret;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
