/**
 * Verify that source manifests are publishable once prepack normalization runs.
 *
 * Usage:
 *   node scripts/verify-no-workspace-protocol.mjs packages/cli packages/core
 *   node ../../scripts/verify-no-workspace-protocol.mjs .
 *
 * This script is safe to run on source manifests before prepack.
 *
 * Checks two invariants before publish:
 * 1. workspace:* / workspace:^ / workspace:~ references can be normalized to real versions
 * 2. non-workspace internal dependencies already point at the current workspace version
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

function normalizeWorkspaceSpecifier(specifier, version) {
  const value = specifier.slice("workspace:".length);
  if (value === "*" || value === "") return version;
  if (value === "^") return `^${version}`;
  if (value === "~") return `~${version}`;
  return value;
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
        if (!workspaceVersion) {
          process.stderr.write(`FAIL: ${dir} — ${field}.${name}: ${specifier} (workspace package not found)\n`);
          dirFailed = true;
          failed = true;
          continue;
        }

        const normalized = normalizeWorkspaceSpecifier(specifier, workspaceVersion);
        if (
          normalized !== workspaceVersion
          && normalized !== `^${workspaceVersion}`
          && normalized !== `~${workspaceVersion}`
        ) {
          process.stderr.write(
            `FAIL: ${dir} — ${field}.${name}: ${specifier} normalizes to ${normalized}, expected ${workspaceVersion}, ^${workspaceVersion}, or ~${workspaceVersion}\n`,
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
