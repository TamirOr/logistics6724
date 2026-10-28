/**
 * Opens a tapped notification's screen: in a window of this app if one is
 * open, else in a new one. Only windows this worker controls qualify:
 * staging lives under production's path on the same origin, and navigate()
 * rejects for a window another worker controls. If navigating still fails,
 * a new window opens rather than nothing happening.
 */
export async function openFromNotification(clients: Clients, url: string): Promise<void> {
  const [open] = await clients.matchAll({ type: "window" });
  if (open) {
    try {
      await open.focus();
      await open.navigate(url);
      return;
    } catch {
      // Fall through to a new window.
    }
  }
  await clients.openWindow(url);
}
