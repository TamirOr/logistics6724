import { describe, expect, it } from "vitest";
import { resolveAddition } from "./ItemAdder";

const untouched = { quantity: 1, quantityTouched: false, measure: "", measureTouched: false };

describe("resolveAddition", () => {
  it("takes the company's last quantity and measure for what the user left alone", () => {
    expect(resolveAddition(untouched, { default_quantity: 20, default_measure: "קרטון" }))
      .toEqual({ quantity: 20, measure: "קרטון" });
  });

  it("keeps what the user entered, a cleared measure included", () => {
    const entered = { quantity: 3, quantityTouched: true, measure: "", measureTouched: true };
    expect(resolveAddition(entered, { default_quantity: 20, default_measure: "קרטון" }))
      .toEqual({ quantity: 3, measure: "" });
  });

  it("uses the entered values when there is no history, with at least 1", () => {
    expect(resolveAddition({ ...untouched, quantity: 0, measure: "ליטר" }, { default_quantity: null, default_measure: null }))
      .toEqual({ quantity: 1, measure: "ליטר" });
    expect(resolveAddition({ ...untouched, measure: "ליטר" })).toEqual({ quantity: 1, measure: "ליטר" });
  });
});
