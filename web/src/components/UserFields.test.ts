import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import type { Unit } from "../lib/types";
import { t } from "../strings";
import { roleOf, UserFields } from "./UserFields";

const unit = (id: string, name: string): Unit => ({ id, name, kind: "supplier", headcount: null, active: true });

describe("UserFields", () => {
  it("shows the service number, email, role and every logistic platoon of a supplier", () => {
    const armorer = makeProfile({
      email: "armorer@example.com", service_number: "7654321", role: "supplier",
      unit_id: "armory", supplier_ids: ["armory", "ordnance"],
    });
    const html = renderToStaticMarkup(createElement(UserFields, {
      user: armorer, units: [unit("armory", "נשקיה"), unit("ordnance", "חימוש")],
    }));
    expect(html).toContain("7654321");
    expect(html).toContain("armorer@example.com");
    expect(html).toContain(`<dt>${t.role}</dt><dd>${t.soldier}</dd>`);
    expect(html).toContain(`<dt>${t.unitOf.supplier}</dt><dd>נשקיה, חימוש</dd>`);
  });

  it("calls a customer's unit a company", () => {
    const html = renderToStaticMarkup(createElement(UserFields, {
      user: makeProfile({ unit_id: "a" }), units: [{ ...unit("a", "פלוגה א׳"), kind: "company" }],
    }));
    expect(html).toContain(`<dt>${t.unitOf.company}</dt><dd>פלוגה א׳</dd>`);
  });

  it("does not show the customer or supplier side", () => {
    const html = renderToStaticMarkup(createElement(UserFields, { user: makeProfile({ role: "supplier" }), units: [] }));
    expect(html).not.toContain(t.side);
    expect(html).not.toContain(t.roleLabels.supplier);
  });
});

describe("roleOf", () => {
  it("is a soldier, a responsible commander or an admin", () => {
    expect(roleOf(makeProfile())).toBe(t.soldier);
    expect(roleOf(makeProfile({ super_user: true }))).toBe(t.superUser);
    expect(roleOf(makeProfile({ role: "admin", unit_id: null }))).toBe(t.roleLabels.admin);
  });
});
