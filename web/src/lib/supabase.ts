import { createClient } from "@supabase/supabase-js";
import { APP_VERSION } from "./version";

// The build refuses to run without these (see vite.config.ts), so a
// misconfigured deploy fails in CI instead of on users' phones.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    // detectSessionInUrl signs in from an emailed link. Codes are the main way
    // in (an installed iPhone app cannot open links); links work until the
    // project has a custom email sender that sends codes (see README).
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    // Lets API logs be matched to the build that made the request.
    global: { headers: { "x-client-version": APP_VERSION } },
  },
);
