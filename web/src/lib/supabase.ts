import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321",
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? "missing-anon-key",
  // detectSessionInUrl signs in from an emailed link. Codes are the main way
  // in (an installed iPhone app cannot open links); links work until the
  // project has a custom email sender that sends codes (see README).
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
