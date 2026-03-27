import { describe, expect, it } from "vitest";

describe("studio server progress extraction", () => {
  it("extracts both Chinese and English stage lines plus streaming telemetry", async () => {
    const progressModulePath = "../../../studio/server-progress.cjs";
    const { extractProgressStages } = await import(progressModulePath);

    expect(
      extractProgressStages(
        [
          "INFO  [inkos] 阶段：保存书籍配置",
          "INFO  [inkos] Stage: Persisting project files",
          "INFO  [inkos] streaming 30s, 2003 chars",
        ].join("\n"),
      ),
    ).toEqual([
      "保存书籍配置",
      "Persisting project files",
      "生成基础设定 (30s, 2003 chars)",
    ]);
  });
});
