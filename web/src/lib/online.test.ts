import { describe, expect, it, vi } from "vitest";
import { loadWhenOnline } from "./online";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("loadWhenOnline", () => {
  it("loads once when the first try succeeds", async () => {
    const load = vi.fn(async () => {});
    loadWhenOnline(load);
    await settle();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again when back online, then stops", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(undefined);
    loadWhenOnline(load);
    await settle();
    window.dispatchEvent(new Event("online"));
    await settle();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stops trying after unmount", async () => {
    const load = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const stop = loadWhenOnline(load);
    await settle();
    stop();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
