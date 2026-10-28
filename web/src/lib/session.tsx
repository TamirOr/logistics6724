// Signed-in user and their profile, for the whole app.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { fetchMyProfile, workAsUnit } from "./api";
import { clearAllCaches, readCache, writeCache } from "./cache";
import { onReturn } from "./foreground";
import { disablePush } from "./push";
import { clearQueue, setQueueUser } from "./queue";
import type { Profile } from "./types";
import { isAdminInUnit, workingProfile } from "./workingProfile";

interface SessionState {
  session: Session | null;
  /** The profile the screens work with: an admin working in a unit is that unit's user here. */
  profile: Profile | null;
  /** An admin working as a unit's user, who can return to admin. */
  adminInUnit: boolean;
  loading: boolean;
  reloadProfile: () => Promise<void>;
  /** Admins: work as the user of a unit, or (null) return to admin. */
  switchWorkingUnit: (unitId: string | null) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);
const PROFILE_CACHE = "profile";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const userId = useRef<string | null>(null);

  // The cached profile shows the app at once; the fresh one replaces it. With
  // no signal the cached one stays, so the app still opens offline.
  const reloadProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user.id ?? null;
    userId.current = user;
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
    // supabase-js also reports SIGNED_IN for the same user when a tab
    // regains focus; the return to the foreground reloads that already.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_OUT" || (event === "SIGNED_IN" && next?.user.id !== userId.current)) reloadProfile();
    });
    return () => data.subscription.unsubscribe();
  }, [reloadProfile]);

  // An admin may approve, move (new unit and role) or deactivate a user while
  // the app is open. Check again whenever it comes back to the foreground.
  useEffect(() => onReturn(reloadProfile), [reloadProfile]);

  // A pending user waits on screen for approval, so also check every 30 s.
  useEffect(() => {
    if (profile?.approval !== "pending") return;
    const timer = setInterval(reloadProfile, 30_000);
    return () => clearInterval(timer);
  }, [profile?.approval, reloadProfile]);

  const signOut = useCallback(async () => {
    clearQueue();
    clearAllCaches();
    // While still signed in, so row-level security lets it delete the row.
    await disablePush().catch(() => {});
    await supabase.auth.signOut();
  }, []);

  // Cached rows and queued edits belong to the screens being left, which
  // the server no longer lets this user see or change.
  const switchWorkingUnit = useCallback(async (unitId: string | null) => {
    await workAsUnit(unitId);
    clearQueue();
    clearAllCaches();
    await reloadProfile();
  }, [reloadProfile]);

  const value: SessionState = {
    session,
    profile: profile && workingProfile(profile),
    adminInUnit: !!profile && isAdminInUnit(profile),
    loading,
    reloadProfile,
    switchWorkingUnit,
    signOut,
  };
  return (
    <SessionContext.Provider value={value}>
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
