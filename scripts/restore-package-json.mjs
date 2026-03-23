/**
 * postpack hook — restores original package.json from backup.
 *
 * Shared by all publishable packages. Invoked as:
 *   "postpack": "node ../../scripts/restore-package-json.mjs"
 */

import { readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

const packageDir = process.cwd();
const packageJsonPath = join(packageDir, "package.json");
const backupPath = join(packageDir, ".package.json.publish-backup");

async function writeAtomic(path, content) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
}

async function main() {
  try {
    const original = await readFile(backupPath, "utf-8");
    await writeAtomic(packageJsonPath, original);
    await rm(backupPath, { force: true });
  } catch {
    // No backup means prepack found nothing to replace — fine.
  }
}

await main();
