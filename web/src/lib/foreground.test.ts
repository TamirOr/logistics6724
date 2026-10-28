import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AWAY_MS, onReturn } from "./foreground";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("onReturn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
  });

  it("fires once the app returns after being away a while", () => {
    const listener = vi.fn();
    const stop = onReturn(listener);
    setVisibility("hidden");
    vi.advanceTimersByTime(AWAY_MS);
    setVisibility("visible");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays quiet after a quick glance away", () => {
    const listener = vi.fn();
    const stop = onReturn(listener);
    setVisibility("hidden");
    vi.advanceTimersByTime(AWAY_MS - 1);
    setVisibility("visible");
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it("stops calling an unsubscribed listener", () => {
    const listener = vi.fn();
    onReturn(listener)();
    setVisibility("hidden");
    vi.advanceTimersByTime(AWAY_MS);
    setVisibility("visible");
    expect(listener).not.toHaveBeenCalled();
  });
});
