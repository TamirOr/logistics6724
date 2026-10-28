import { describe, expect, it } from "vitest";
import { makeRequest } from "../../test/fixtures";
import { groupByEventAndCompany } from "./supplierGroups";

describe("groupByEventAndCompany", () => {
  const names: Record<string, string> = { a: "אלפא", b: "בטא" };
  const companyName = (id: string) => names[id];

  it("groups by event, companies alphabetically, urgent then oldest first", () => {
    const old = makeRequest({ id: "old", event_id: "e1", company_id: "a", created_at: "2026-10-27T08:00:00Z" });
    const urgent = makeRequest({ id: "urgent", event_id: "e1", company_id: "a", urgent: true, created_at: "2026-10-27T09:00:00Z" });
    const newer = makeRequest({ id: "newer", event_id: "e1", company_id: "a", created_at: "2026-10-27T10:00:00Z" });
    const otherCompany = makeRequest({ id: "b1", event_id: "e1", company_id: "b" });
    const otherEvent = makeRequest({ id: "e2r", event_id: "e2", company_id: "a" });

    const groups = groupByEventAndCompany([otherCompany, newer, old, urgent, otherEvent], companyName);

    expect(groups.get("e1")?.map((g) => g.companyId)).toEqual(["a", "b"]);
    expect(groups.get("e1")?.[0].rows.map((r) => r.id)).toEqual(["urgent", "old", "newer"]);
    expect(groups.get("e2")?.[0].rows.map((r) => r.id)).toEqual(["e2r"]);
  });

  it("is empty with no rows", () => {
    expect(groupByEventAndCompany([], companyName).size).toBe(0);
  });
});
