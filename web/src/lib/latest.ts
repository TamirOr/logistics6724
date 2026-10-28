/**
 * Tells whether a response still belongs to the newest request. Responses
 * can arrive out of order (a slow search, a refetch for the previous unit),
 * and the older one must not replace the newer.
 *
 *   const isLatest = requests.start();
 *   const data = await load();
 *   if (isLatest()) show(data);
 */
export function latestRequest() {
  let newest = 0;
  return {
    start(): () => boolean {
      const id = ++newest;
      return () => id === newest;
    },
  };
}
