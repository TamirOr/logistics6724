import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import type { Unit } from "../lib/types";
import { ProfileCard } from "./ProfileCard";

const unit = (id: string, name: string): Unit => ({ id, name, kind: "supplier", headcount: null, active: true });
const units = [unit("kitchen", "מטבח"), unit("closing", "סגירה")];
const cook = makeProfile({
  first_name: "דנה", last_name: "כהן", service_number: "7654321", role: "supplier",
  unit_id: "kitchen", supplier_ids: ["kitchen", "closing"],
});

describe("ProfileCard", () => {
  it("shows the name and the unit the screen shows, then the full profile", () => {
    const html = renderToStaticMarkup(createElement(ProfileCard, { profile: cook, units, activeUnitId: "closing" }));
    const summary = html.slice(html.indexOf("<summary>"), html.indexOf("</summary>"));
    expect(summary).toContain("דנה כהן");
    expect(summary).toContain("סגירה");
    expect(summary).not.toContain("מטבח");
    expect(html).toContain("7654321");
    expect(html).toContain("מטבח, סגירה");
  });

  it("shows the name alone until the units load", () => {
    const html = renderToStaticMarkup(createElement(ProfileCard, { profile: cook, units: [], activeUnitId: "kitchen" }));
    expect(html).toContain("דנה כהן");
    expect(html).not.toContain(" · ");
  });

  it("shows a customer's company", () => {
    const soldier = makeProfile({ first_name: "יוסי", last_name: "לוי", role: "customer", unit_id: "b" });
    const companies = [{ id: "b", name: "פלוגה ב", kind: "company" as const, headcount: 80, active: true }];
    const html = renderToStaticMarkup(createElement(ProfileCard, { profile: soldier, units: companies, activeUnitId: "b" }));
    const summary = html.slice(html.indexOf("<summary>"), html.indexOf("</summary>"));
    expect(summary).toContain("יוסי לוי");
    expect(summary).toContain("פלוגה ב");
  });
});
