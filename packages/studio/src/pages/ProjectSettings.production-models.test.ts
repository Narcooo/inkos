import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectSettings } from "./ProjectSettings.js";

describe("ProjectSettings production model controls", () => {
  it("renders compact searchable explicit model controls instead of five static selects", () => {
    const html = renderToStaticMarkup(createElement(ProjectSettings, {
      nav: { toDashboard: () => undefined } as never,
      theme: "light",
      t: ((key: string) => key) as never,
    }));

    expect(html).toContain('data-testid="production-role-models"');
    expect(html).toContain('aria-label="Search or enter Writer model"');
    expect(html).toContain("Initial chapter prose generation.");
    expect(html).toContain("VERIFIED_IN_CURRENT_CATALOG");
    expect(html).not.toContain("Drafts and revises chapter prose.");
  });
});
