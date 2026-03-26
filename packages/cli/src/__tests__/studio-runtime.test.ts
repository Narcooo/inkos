import path from "node:path";
import { describe, expect, it } from "vitest";

describe("studio server runtime helpers", () => {
  it("resolves cli/core paths from installed packages when no repo root is available", async () => {
    const runtimeModulePath = "../../../studio/server-runtime.cjs";
    const { resolveCliPath, resolveCorePath } = await import(runtimeModulePath);

    const resolvePackageJson = (packageName: string) => {
      if (packageName === "@actalk/inkos") {
        return "/portable/node_modules/@actalk/inkos/package.json";
      }
      if (packageName === "@actalk/inkos-core") {
        return "/portable/node_modules/@actalk/inkos-core/package.json";
      }
      return null;
    };
    const exists = (target: string | null) =>
      target === "/portable/node_modules/@actalk/inkos/dist/index.js"
      || target === "/portable/node_modules/@actalk/inkos-core/dist/index.js";

    expect(resolveCliPath({
      repoRoot: null,
      projectRoot: "/portable/project",
      currentDir: "/portable/node_modules/@actalk/inkos-studio",
      resolvePackageJson,
      exists,
      pathModule: path.posix,
    })).toBe("/portable/node_modules/@actalk/inkos/dist/index.js");

    expect(resolveCorePath({
      repoRoot: null,
      projectRoot: "/portable/project",
      currentDir: "/portable/node_modules/@actalk/inkos-studio",
      resolvePackageJson,
      exists,
      pathModule: path.posix,
    })).toBe("/portable/node_modules/@actalk/inkos-core/dist/index.js");
  });

  it("returns null instead of throwing when cli/core cannot be found in standalone mode", async () => {
    const runtimeModulePath = "../../../studio/server-runtime.cjs";
    const { resolveCliPath, resolveCorePath } = await import(runtimeModulePath);

    const exists = () => false;
    const resolvePackageJson = () => null;

    expect(resolveCliPath({
      repoRoot: null,
      projectRoot: "/portable/project",
      currentDir: "/portable/app",
      resolvePackageJson,
      exists,
    })).toBeNull();

    expect(resolveCorePath({
      repoRoot: null,
      projectRoot: "/portable/project",
      currentDir: "/portable/app",
      resolvePackageJson,
      exists,
    })).toBeNull();
  });
});
