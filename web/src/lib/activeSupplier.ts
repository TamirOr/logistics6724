// A supplier user in several supplier units works in one of them at a time:
// the home screen and the catalog show that unit. The choice is kept on
// the device, and every screen that shows it follows a change at once.
import { useSyncExternalStore } from "react";
import { readCache, writeCache } from "./cache";
import { useProfile } from "./session";
import type { Profile } from "./types";

const ACTIVE_SUPPLIER = "active-supplier";
const listeners = new Set<() => void>();

/** The stored unit while the user still belongs to it, else their main unit. */
export function pickActiveSupplier(stored: string | null, profile: Profile): string {
  // A profile cached by the previous build has no supplier_ids.
  return stored && profile.supplier_ids?.includes(stored) ? stored : profile.unit_id!;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function setActiveSupplier(supplierId: string): void {
  writeCache(ACTIVE_SUPPLIER, supplierId);
  listeners.forEach((notify) => notify());
}

export function useActiveSupplier(): string {
  const profile = useProfile();
  const stored = useSyncExternalStore(subscribe, () => readCache<string>(ACTIVE_SUPPLIER));
  return pickActiveSupplier(stored, profile);
}
