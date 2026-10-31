import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT } from "../lib/profileDraft";
import { ProfileInputs } from "./ProfileInputs";
import { t } from "../strings";

const units = [
  { id: "a", name: "פלוגה א׳", kind: "company" as const },
  { id: "kitchen", name: "מטבח", kind: "supplier" as const },
];
const render = (role: "customer" | "supplier") =>
  renderToStaticMarkup(createElement(ProfileInputs, { draft: { ...EMPTY_DRAFT, role }, units, onChange: () => {} }));

describe("ProfileInputs", () => {
  it("offers a customer the companies only", () => {
    const html = render("customer");
    expect(html).toContain("פלוגה א׳");
    expect(html).not.toContain("מטבח");
  });

  it("offers a supplier the supplier units, several at once", () => {
    const html = render("supplier");
    expect(html).toContain("מטבח");
    expect(html).not.toContain("פלוגה א׳");
    expect(html).toContain(t.supplierUnitsHint);
  });
});
