import { describe, expect, it } from "vitest";
import { latestRequest } from "./latest";

describe("latestRequest", () => {
  it("lets only the newest request's response through", () => {
    const requests = latestRequest();
    const first = requests.start();
    const second = requests.start();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("keeps separate counters apart", () => {
    const a = latestRequest();
    const b = latestRequest();
    const isLatestA = a.start();
    b.start();
    expect(isLatestA()).toBe(true);
  });
});
