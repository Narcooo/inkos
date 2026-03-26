import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

describe("studio scaffold", () => {
  it("routes the web build into dist/web", () => {
    expect(viteConfig.build?.outDir).toBe("dist/web");
  });
});
