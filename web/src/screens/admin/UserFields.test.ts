import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../../test/fixtures";
import type { Unit } from "../../lib/types";
import { UserFields } from "./UserFields";

const unit = (id: string, name: string): Unit => ({ id, name, kind: "supplier", headcount: null, active: true });

describe("UserFields", () => {
  it("shows the service number, email, side and every supplier unit", () => {
    const cook = makeProfile({
      email: "cook@example.com", service_number: "7654321", role: "supplier",
      unit_id: "kitchen", supplier_ids: ["kitchen", "closing"],
    });
    const html = renderToStaticMarkup(createElement(UserFields, {
      user: cook, units: [unit("kitchen", "מטבח"), unit("closing", "סגירה")],
    }));
    expect(html).toContain("7654321");
    expect(html).toContain("cook@example.com");
    expect(html).toContain("ספק");
    expect(html).toContain("מטבח, סגירה");
  });
});
