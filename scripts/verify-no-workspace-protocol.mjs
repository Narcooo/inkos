/**
 * Verify that internal dependencies resolve to the current workspace version.
 *
 * Usage:
 *   node scripts/verify-no-workspace-protocol.mjs packages/cli packages/core
 *   node ../../scripts/verify-no-workspace-protocol.mjs .
 *
 * Checks two invariants before publish:
 * Source manifests may use workspace:* so local builds cannot silently resolve an
 * older registry package. The prepack hook replaces it before prepublishOnly runs.
 */

import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  process.stderr.write("Usage: node verify-no-workspace-protocol.mjs <pkg-dir> [<pkg-dir>...]\n");
  process.exit(1);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRoot(startDir) {
  let dir = resolve(startDir);

  for (let i = 0; i < 10; i++) {
    if (await exists(join(dir, "packages"))) {
      return dir;
    }

    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`Could not find workspace root from ${startDir}`);
}

async function loadWorkspaceVersions(workspaceRoot) {
  const packagesDir = join(workspaceRoot, "packages");
  const entries = await readdir(packagesDir);
  const versions = new Map();

  for (const entry of entries) {
    try {
      const raw = await readFile(join(packagesDir, entry, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      versions.set(pkg.name, pkg.version);
    } catch {
      // ignore directories that are not publishable packages
    }
  }

  return versions;
}

let failed = false;
const workspaceRoot = await findWorkspaceRoot(process.cwd());
const workspaceVersions = await loadWorkspaceVersions(workspaceRoot);

for (const dirArg of dirs) {
  const dir = resolve(process.cwd(), dirArg);
  const packageJsonPath = join(dir, "package.json");
  const raw = await readFile(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw);
  let dirFailed = false;

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      const workspaceVersion = workspaceVersions.get(name);
      if (typeof specifier !== "string") {
        continue;
      }

      if (specifier.startsWith("workspace:")) {
        if (!workspaceVersion || !["workspace:*", "workspace:^", "workspace:~"].includes(specifier)) {
          process.stderr.write(
            `FAIL: ${dir} — ${field}.${name}: invalid workspace dependency ${specifier}\n`,
          );
          dirFailed = true;
          failed = true;
        }
        continue;
      }

      if (
        workspaceVersion
        && specifier !== workspaceVersion
        && specifier !== `^${workspaceVersion}`
        && specifier !== `~${workspaceVersion}`
      ) {
        process.stderr.write(
          `FAIL: ${dir} — ${field}.${name}: expected ${workspaceVersion}, ^${workspaceVersion}, or ~${workspaceVersion}, got ${specifier}\n`,
        );
        dirFailed = true;
        failed = true;
      }
    }
  }

  if (!dirFailed) {
    process.stderr.write(`OK: ${dir}\n`);
  }
}

if (failed) {
  process.exit(1);
}
