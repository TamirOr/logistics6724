import { describe, expect, it, vi } from "vitest";
import { openFromNotification } from "./notificationClick";

const URL_ = "https://example.github.io/app/events/e1";

function fakeClients(windows: unknown[]) {
  return {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async () => null),
  } as unknown as Clients & { matchAll: ReturnType<typeof vi.fn>; openWindow: ReturnType<typeof vi.fn> };
}

describe("openFromNotification", () => {
  it("navigates an open window of this app", async () => {
    const win = { focus: vi.fn(async () => win), navigate: vi.fn(async () => win) } as unknown as WindowClient;
    const clients = fakeClients([win]);
    await openFromNotification(clients, URL_);
    expect(clients.matchAll).toHaveBeenCalledWith({ type: "window" });
    expect(win.navigate).toHaveBeenCalledWith(URL_);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when navigating fails", async () => {
    const win = { focus: vi.fn(async () => win), navigate: vi.fn(async () => { throw new TypeError("not controlled"); }) };
    const clients = fakeClients([win]);
    await openFromNotification(clients, URL_);
    expect(clients.openWindow).toHaveBeenCalledWith(URL_);
  });

  it("opens a new window when none is open", async () => {
    const clients = fakeClients([]);
    await openFromNotification(clients, URL_);
    expect(clients.openWindow).toHaveBeenCalledWith(URL_);
  });
});
