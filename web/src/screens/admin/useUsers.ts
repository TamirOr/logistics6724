import { useCallback, useEffect, useState } from "react";
import { fetchUsers } from "../../lib/api";
import type { Profile } from "../../lib/types";

export function useUsers() {
  const [users, setUsers] = useState<Profile[] | null>(null);
  const reload = useCallback(() => fetchUsers().then(setUsers), []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { users, reload };
}
