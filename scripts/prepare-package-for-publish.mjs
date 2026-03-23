/**
 * prepack hook — replaces workspace:* with real version numbers in package.json.
 *
 * Shared by all publishable packages. Invoked as:
 *   "prepack": "node ../../scripts/prepare-package-for-publish.mjs"
 *
 * Expects process.cwd() to be the package directory (npm/pnpm guarantee this).
 */

import { readFile, writeFile, copyFile, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageDir = process.cwd();
const packageJsonPath = join(packageDir, "package.json");
const backupPath = join(packageDir, ".package.json.publish-backup");

async function writeAtomic(path, content) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
}

// Walk up to workspace root (contains pnpm-workspace.yaml)
function findWorkspaceRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    try {
      // Sync check not available in ESM, so we just hardcode the relative path
      // since all packages are at packages/<name>/
      return resolve(dir, "..", "..");
    } catch {
      dir = resolve(dir, "..");
    }
  }
  throw new Error("Could not find workspace root");
}

function normalizeWorkspaceSpecifier(specifier, version) {
  const value = specifier.slice("workspace:".length);
  if (value === "*" || value === "") return version;
  if (value === "^") return `^${version}`;
  if (value === "~") return `~${version}`;
  return value;
}

async function loadWorkspaceVersions(workspaceRoot) {
  const packagesDir = join(workspaceRoot, "packages");
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(packagesDir);

  const versions = new Map();
  for (const entry of entries) {
    try {
      const raw = await readFile(join(packagesDir, entry, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      versions.set(pkg.name, pkg.version);
    } catch {
      // not a package dir
    }
  }
  return versions;
}

async function main() {
  const raw = await readFile(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw);

  // Check if there are any workspace: specifiers at all
  let hasWorkspaceDeps = false;
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const specifier of Object.values(deps)) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
        hasWorkspaceDeps = true;
        break;
      }
    }
    if (hasWorkspaceDeps) break;
  }

  if (!hasWorkspaceDeps) {
    // Nothing to do — skip backup/rewrite to avoid unnecessary churn
    return;
  }

  const workspaceRoot = findWorkspaceRoot(packageDir);
  const versions = await loadWorkspaceVersions(workspaceRoot);

  // Backup original
  await copyFile(packageJsonPath, backupPath);

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier !== "string" || !specifier.startsWith("workspace:")) continue;
      const version = versions.get(name);
      if (!version) {
        throw new Error(`Unable to resolve workspace dependency version for "${name}"`);
      }
      deps[name] = normalizeWorkspaceSpecifier(specifier, version);
    }
  }

  await writeAtomic(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  process.stderr.write(`[prepack] Replaced workspace:* deps in ${pkg.name}\n`);

  // Verify: re-read and confirm no workspace: references remain
  const verifyRaw = await readFile(packageJsonPath, "utf-8");
  const verifyPkg = JSON.parse(verifyRaw);
  const violations = [];
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = verifyPkg[field];
    if (!deps) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
        violations.push(`  ${field}.${name}: ${specifier}`);
      }
    }
  }
  if (violations.length > 0) {
    process.stderr.write(
      `[prepack] FATAL: workspace: references remain after replacement!\n` +
      `${violations.join("\n")}\n`,
    );
    // Restore backup before aborting
    const original = await readFile(backupPath, "utf-8");
    await writeAtomic(packageJsonPath, original);
    await rm(backupPath, { force: true });
    process.exit(1);
  }
}

await main();
