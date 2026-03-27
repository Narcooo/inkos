// Copy all assets needed for standalone distribution into dist/
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const distDir = path.resolve(__dirname, "..", "dist");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

console.log("Copying dist assets...");

// 1. Web UI
const publicSrc = path.resolve(__dirname, "..", "public");
const publicDest = path.join(distDir, "public");
fs.cpSync(publicSrc, publicDest, { recursive: true });
console.log("  public → dist/public");

// 2. CLI with full directory structure
const cliDist = path.join(distDir, "cli");
if (fs.existsSync(cliDist)) fs.rmSync(cliDist, { recursive: true });
fs.mkdirSync(path.join(cliDist, "dist"), { recursive: true });
fs.cpSync(
  path.join(repoRoot, "packages", "cli", "dist"),
  path.join(cliDist, "dist"),
  { recursive: true },
);

// Fix CLI package.json: replace workspace:* with actual version
const cliPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages", "cli", "package.json"), "utf8"),
);
const corePkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages", "core", "package.json"), "utf8"),
);
if (cliPkg.dependencies) {
  for (const [k, v] of Object.entries(cliPkg.dependencies)) {
    if (v.startsWith("workspace:")) cliPkg.dependencies[k] = corePkg.version;
  }
}
delete cliPkg.devDependencies;
fs.writeFileSync(path.join(cliDist, "package.json"), JSON.stringify(cliPkg, null, 2));
console.log("  cli/package.json (workspace:* fixed)");

// 3. Core into CLI's node_modules
const coreTarget = path.join(cliDist, "node_modules", "@actalk", "inkos-core");
fs.mkdirSync(path.join(coreTarget, "dist"), { recursive: true });
fs.cpSync(
  path.join(repoRoot, "packages", "core", "dist"),
  path.join(coreTarget, "dist"),
  { recursive: true },
);
fs.copyFileSync(
  path.join(repoRoot, "packages", "core", "package.json"),
  path.join(coreTarget, "package.json"),
);
const genresDir = path.join(repoRoot, "packages", "core", "genres");
if (fs.existsSync(genresDir)) {
  fs.cpSync(genresDir, path.join(coreTarget, "genres"), { recursive: true });
}
console.log("  core → cli/node_modules/@actalk/inkos-core/");

// 4. Install CLI runtime dependencies
console.log("  Installing CLI runtime dependencies...");
try {
  execSync("npm install --omit=dev --no-package-lock", {
    cwd: cliDist,
    stdio: "pipe",
  });
  console.log("  npm install OK");
} catch (err) {
  console.error("  npm install failed:", String(err.stderr || err).slice(0, 300));
}

// 5. Bundle core as CJS for pkg (pkg Node 18 can't dynamic-import ESM)
const coreBundleDest = path.join(distDir, "core-bundle.cjs");
console.log("  Bundling core as CJS for pkg...");
try {
  // Write a shim that polyfills import.meta.url before the bundle
  const shimPath = path.join(distDir, "_core-shim.cjs");
  fs.writeFileSync(shimPath, [
    `const {pathToFileURL}=require("node:url");`,
    `const {createRequire:_cr}=require("node:module");`,
    `const _url=pathToFileURL(__filename).href;`,
    // Patch globalThis so the bundled code's import.meta references resolve
    `if(!globalThis.__import_meta_url)globalThis.__import_meta_url=_url;`,
  ].join("\n"));
  execSync(
    `npx esbuild ${path.join(repoRoot, "packages", "core", "dist", "index.js")} --bundle --platform=node --format=cjs --outfile=${coreBundleDest} --external:node:* --inject:${shimPath} --define:import.meta.url=globalThis.__import_meta_url`,
    { cwd: repoRoot, stdio: "pipe" },
  );
  // Clean up shim
  fs.unlinkSync(shimPath);
  console.log("  core-bundle.cjs OK");
} catch (err) {
  console.error("  esbuild failed:", String(err.stderr || err).slice(0, 300));
}

// 6. Node.js runtime (copy system node.exe — pkg's cached binary doesn't support CLI flags)
const nodeExeDest = path.join(distDir, "node.exe");
if (!fs.existsSync(nodeExeDest)) {
  const systemNode = process.execPath;
  fs.copyFileSync(systemNode, nodeExeDest);
  console.log(`  ${systemNode} → dist/node.exe`);
}

console.log("Done.");
