import { describe, expect, it, vi } from "vitest";
import { goBack } from "./navigation";

describe("goBack", () => {
  it("goes to the home screen when the page was opened directly", () => {
    const navigate = vi.fn();
    goBack(navigate, { key: "default" });
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("returns to the previous screen inside the app", () => {
    const navigate = vi.fn();
    goBack(navigate, { key: "a1b2c3" });
    expect(navigate).toHaveBeenCalledWith(-1);
  });
});
