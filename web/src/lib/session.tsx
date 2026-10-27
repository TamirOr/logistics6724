// Signed-in user and their profile, for the whole app.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { fetchMyProfile } from "./api";
import { clearCache, readCache, writeCache } from "./cache";
import { clearQueue, setQueueUser } from "./queue";
import type { Profile } from "./types";

interface SessionState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);
const PROFILE_CACHE = "profile";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // The cached profile shows the app at once; the fresh one replaces it. With
  // no signal the cached one stays, so the app still opens offline.
  const reloadProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user.id ?? null;
    setQueueUser(user);
    setSession(data.session);
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const cached = readCache<Profile>(PROFILE_CACHE);
    if (cached?.id === user) {
      setProfile(cached);
      setLoading(false);
    }
    try {
      const fresh = await fetchMyProfile(user);
      setProfile(fresh);
      if (fresh) writeCache(PROFILE_CACHE, fresh);
    } catch {
      // Offline: keep the cached profile, if there is one.
    }
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
    clearQueue();
    clearCache(PROFILE_CACHE);
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
