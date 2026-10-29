import { describe, expect, it } from "vitest";
import { makeRequest } from "../test/fixtures";
import { offeredStatuses } from "./StatusPicker";

const ALL = ["ready", "partial", "missing", "pending", "collected"] as const;

describe("offeredStatuses", () => {
  it("leaves out the current status", () => {
    expect(offeredStatuses(makeRequest({ status: "missing" }), [...ALL])).toEqual(["ready", "partial", "pending", "collected"]);
  });

  it("keeps partial offered while partial, so its quantity can change", () => {
    expect(offeredStatuses(makeRequest({ status: "partial", supplied_quantity: 3 }), [...ALL])).toContain("partial");
  });

  it("offers partial only for a quantity over 1", () => {
    expect(offeredStatuses(makeRequest({ quantity: 1 }), [...ALL])).not.toContain("partial");
  });
});
