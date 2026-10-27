// Signed-in user and their profile, for the whole app.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { fetchMyProfile } from "./api";
import type { Profile } from "./types";

interface SessionState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setProfile(data.session ? await fetchMyProfile(data.session.user.id) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reloadProfile();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") reloadProfile();
    });
    return () => data.subscription.unsubscribe();
  }, [reloadProfile]);

  // A pending user waits on screen; check again when they come back to it.
  useEffect(() => {
    if (profile?.approval !== "pending") return;
    const onVisible = () => document.visibilityState === "visible" && reloadProfile();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(reloadProfile, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [profile?.approval, reloadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <SessionContext.Provider value={{ session, profile, loading, reloadProfile, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/** The approved user's profile. Only used on screens behind the approval gate. */
export function useProfile(): Profile {
  const { profile } = useSession();
  if (!profile) throw new Error("no profile");
  return profile;
}
