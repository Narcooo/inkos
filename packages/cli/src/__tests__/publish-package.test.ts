import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..", "..");
const workspaceRoot = resolve(cliDir, "..", "..");
const studioDir = resolve(workspaceRoot, "packages", "studio");
const sourceCliPackageJsonPromise = readFile(resolve(cliDir, "package.json"), "utf-8").then((raw) =>
  JSON.parse(raw),
);
const sourceStudioPackageJsonPromise = readFile(resolve(studioDir, "package.json"), "utf-8").then((raw) =>
  JSON.parse(raw),
);

async function packPackage(packageDir: string, packDir: string) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCmd, ["pack", "--pack-destination", packDir], {
    cwd: packageDir,
    env: process.env,
    encoding: "utf-8",
    shell: process.platform === "win32",
  });

  const tgzFiles = (await readdir(packDir)).filter((name) => name.endsWith(".tgz"));
  if (tgzFiles.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tgzFiles.length}`);
  }

  return join(packDir, tgzFiles[0]);
}

async function extractPackedPackageJson(packageDir: string, packDir: string) {
  const tarballPath = await packPackage(packageDir, packDir);
  const tarArgs = process.platform === "win32" ? ["--force-local", "-xOf"] : ["-xOf"];
  return execFileSync("tar", [...tarArgs, tarballPath, "package/package.json"], {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });
}

describe.sequential("publish packaging", () => {
  it("rewrites workspace package versions for canary publishing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "inkos-version-script-"));
    const tempPackagesDir = join(tempRoot, "packages");
    const tempCoreDir = join(tempPackagesDir, "core");
    const tempCliDir = join(tempPackagesDir, "cli");

    try {
      await mkdir(tempCoreDir, { recursive: true });
      await mkdir(tempCliDir, { recursive: true });

      await writeFile(
        join(tempRoot, "package.json"),
        `${JSON.stringify({ name: "inkos", version: "0.4.6" }, null, 2)}\n`,
      );
      await writeFile(
        join(tempCoreDir, "package.json"),
        `${JSON.stringify({ name: "@actalk/inkos-core", version: "0.4.6" }, null, 2)}\n`,
      );
      await writeFile(
        join(tempCliDir, "package.json"),
        `${JSON.stringify(
          {
            name: "@actalk/inkos",
            version: "0.4.6",
            dependencies: {
              "@actalk/inkos-core": "workspace:*",
              commander: "^13.0.0",
            },
          },
          null,
          2,
        )}\n`,
      );

      execFileSync(
        "node",
        [resolve(workspaceRoot, "scripts/set-package-versions.mjs"), "0.4.8-canary.7", "--root", tempRoot],
        {
          cwd: workspaceRoot,
          env: process.env,
          encoding: "utf-8",
        },
      );

      const rootPackageJson = JSON.parse(await readFile(join(tempRoot, "package.json"), "utf-8"));
      const corePackageJson = JSON.parse(await readFile(join(tempCoreDir, "package.json"), "utf-8"));
      const cliPackageJson = JSON.parse(await readFile(join(tempCliDir, "package.json"), "utf-8"));

      expect(rootPackageJson.version).toBe("0.4.8-canary.7");
      expect(corePackageJson.version).toBe("0.4.8-canary.7");
      expect(cliPackageJson.version).toBe("0.4.8-canary.7");
      expect(cliPackageJson.dependencies["@actalk/inkos-core"]).toBe("0.4.8-canary.7");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps source CLI dependencies linked through the workspace protocol", async () => {
    const cliPackageJson = await sourceCliPackageJsonPromise;

    expect(cliPackageJson.dependencies["@actalk/inkos-core"]).toBe("workspace:*");
    expect(cliPackageJson.dependencies["@actalk/inkos-studio"]).toBe("workspace:*");
  });

  it("verifies publishable manifests before npm publish runs", async () => {
    const cliPackageJson = await sourceCliPackageJsonPromise;
    const corePackageJson = JSON.parse(
      await readFile(resolve(workspaceRoot, "packages/core/package.json"), "utf-8"),
    );

    expect(cliPackageJson.scripts.prepublishOnly).toBe(
      "node ../../scripts/verify-no-workspace-protocol.mjs .",
    );
    expect(corePackageJson.scripts.prepublishOnly).toBe(
      "node ../../scripts/verify-no-workspace-protocol.mjs .",
    );
  });

  it("allows source workspace protocol manifests when they normalize cleanly for publish", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "inkos-publish-verify-pass-"));
    const tempPackagesDir = join(tempRoot, "packages");
    const tempCoreDir = join(tempPackagesDir, "core");
    const tempCliDir = join(tempPackagesDir, "cli");

    try {
      await mkdir(tempCoreDir, { recursive: true });
      await mkdir(tempCliDir, { recursive: true });

      await writeFile(
        join(tempRoot, "package.json"),
        `${JSON.stringify({ name: "inkos", version: "0.5.1" }, null, 2)}\n`,
      );
      await writeFile(
        join(tempCoreDir, "package.json"),
        `${JSON.stringify({ name: "@actalk/inkos-core", version: "0.5.1" }, null, 2)}\n`,
      );
      await writeFile(
        join(tempCliDir, "package.json"),
        `${JSON.stringify(
          {
            name: "@actalk/inkos",
            version: "0.5.1",
            dependencies: {
              "@actalk/inkos-core": "workspace:*",
              commander: "^13.0.0",
            },
          },
          null,
          2,
        )}\n`,
      );

      expect(() =>
        execFileSync(
          "node",
          [resolve(workspaceRoot, "scripts/verify-no-workspace-protocol.mjs"), "packages/core", "packages/cli"],
          {
            cwd: tempRoot,
            env: process.env,
            encoding: "utf-8",
            stdio: "pipe",
          },
        )).not.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects workspace protocol manifests that normalize to the wrong internal version", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "inkos-publish-verify-fail-"));
    const tempPackagesDir = join(tempRoot, "packages");
    const tempCoreDir = join(tempPackagesDir, "core");
    const tempCliDir = join(tempPackagesDir, "cli");

    try {
      await mkdir(tempCoreDir, { recursive: true });
      await mkdir(tempCliDir, { recursive: true });

      await writeFile(
        join(tempRoot, "package.json"),
        `${JSON.stringify({ name: "inkos", version: "0.5.1" }, null, 2)}\n`,
      );
      await writeFile(
        join(tempCoreDir, "package.json"),
        `${JSON.stringify({ name: "@actalk/inkos-core", version: "0.5.1" }, null, 2)}\n`,
      );
      await writeFile(
        join(tempCliDir, "package.json"),
        `${JSON.stringify(
          {
            name: "@actalk/inkos",
            version: "0.5.1",
            dependencies: {
              "@actalk/inkos-core": "workspace:0.5.0",
            },
          },
          null,
          2,
        )}\n`,
      );

      expect(() =>
        execFileSync(
          "node",
          [resolve(workspaceRoot, "scripts/verify-no-workspace-protocol.mjs"), "packages/cli"],
          {
            cwd: tempRoot,
            env: process.env,
            encoding: "utf-8",
            stdio: "pipe",
          },
        )).toThrow(/normalizes to 0\.5\.0, expected 0\.5\.1/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("replaces workspace dependencies before npm pack", { timeout: 30_000 }, async () => {
    const packDir = await mkdtemp(join(tmpdir(), "inkos-cli-pack-"));

    try {
      const packedPackageJson = JSON.parse(await extractPackedPackageJson(cliDir, packDir));
      const corePackageJson = JSON.parse(
        await readFile(resolve(workspaceRoot, "packages/core/package.json"), "utf-8"),
      );
      const studioPackageJson = await sourceStudioPackageJsonPromise;

      expect(packedPackageJson.dependencies["@actalk/inkos-core"]).toBe(corePackageJson.version);
      expect(packedPackageJson.dependencies["@actalk/inkos-studio"]).toBe(studioPackageJson.version);
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });

  it("packs the studio runtime entry alongside the built frontend", { timeout: 60_000 }, async () => {
    const packDir = await mkdtemp(join(tmpdir(), "inkos-studio-pack-"));

    try {
      const tarballPath = await packPackage(studioDir, packDir);
      const tarArgs = process.platform === "win32" ? ["--force-local", "-tf"] : ["-tf"];
      const archiveListing = execFileSync("tar", [...tarArgs, tarballPath], {
        cwd: workspaceRoot,
        encoding: "utf-8",
      });

      expect(archiveListing).toContain("package/dist/index.html");
      expect(archiveListing).toContain("package/dist/api/index.js");
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });
});
