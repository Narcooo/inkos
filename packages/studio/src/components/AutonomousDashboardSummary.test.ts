import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutonomousDashboardSummary } from "./AutonomousDashboardSummary.js";

describe("Dashboard autonomous summary", () => {
  it("renders one compact operator line without role, token, blocker, or start controls", () => {
    const html = renderToStaticMarkup(createElement(AutonomousDashboardSummary, {
      autonomous: {
        totalChapters: 156,
        nextChapter: 5,
        currentVolume: { volumeNumber: 1, startChapter: 1, endChapter: 38 },
        runtimeStatus: "BLOCKED",
        actualCostUsd: null,
        currentVolumeForecast: { lowUsd: 12, baseUsd: 15, highUsd: 18 },
      },
      onOpen: () => undefined,
    }));
    expect(html).toContain("Volume I · 001–038");
    expect(html).toContain("Next Chapter 005");
    expect(html).toContain("BLOCKED");
    expect(html).toContain("Actual Unavailable");
    expect(html).toContain("Forecast $12.00–$18.00");
    expect(html).toContain("Open Production");
    expect(html).not.toContain("Run / Resume");
    expect(html).not.toContain("Token");
    expect(html).not.toContain("Runtime blockers");
  });
});
