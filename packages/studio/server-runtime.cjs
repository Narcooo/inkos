const path = require("node:path");
const { existsSync } = require("node:fs");

function defaultResolvePackageJson(packageName, searchPaths) {
  try {
    return require.resolve(`${packageName}/package.json`, {
      paths: searchPaths.filter(Boolean),
    });
  } catch {
    return null;
  }
}

function firstExisting(candidates, exists) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolvePackageDistPath(packageName, distPath, {
  projectRoot,
  currentDir,
  pathModule,
  resolvePackageJson,
}) {
  const packageJsonPath = resolvePackageJson(packageName, [projectRoot, currentDir]);
  if (!packageJsonPath) return null;
  return pathModule.join(pathModule.dirname(packageJsonPath), distPath);
}

function resolveCliPath({
  env = process.env,
  repoRoot = null,
  projectRoot = process.cwd(),
  currentDir = __dirname,
  exists = existsSync,
  pathModule = path,
  resolvePackageJson = defaultResolvePackageJson,
} = {}) {
  const candidates = [
    env.INKOS_CLI_PATH ? pathModule.resolve(env.INKOS_CLI_PATH) : null,
    repoRoot ? pathModule.join(repoRoot, "packages", "cli", "dist", "index.js") : null,
    // Packaged exe: look for cli/dist/index.js next to the exe
    pathModule.join(currentDir, "cli", "dist", "index.js"),
    resolvePackageDistPath("@actalk/inkos", "dist/index.js", {
      projectRoot,
      currentDir,
      pathModule,
      resolvePackageJson,
    }),
  ];
  return firstExisting(candidates, exists);
}

function resolveCorePath({
  env = process.env,
  repoRoot = null,
  projectRoot = process.cwd(),
  currentDir = __dirname,
  exists = existsSync,
  pathModule = path,
  resolvePackageJson = defaultResolvePackageJson,
} = {}) {
  const candidates = [
    env.INKOS_CORE_PATH ? pathModule.resolve(env.INKOS_CORE_PATH) : null,
    repoRoot ? pathModule.join(repoRoot, "packages", "core", "dist", "index.js") : null,
    // Packaged exe: core is bundled inside cli/node_modules
    pathModule.join(currentDir, "cli", "node_modules", "@actalk", "inkos-core", "dist", "index.js"),
    resolvePackageDistPath("@actalk/inkos-core", "dist/index.js", {
      projectRoot,
      currentDir,
      pathModule,
      resolvePackageJson,
    }),
  ];
  return firstExisting(candidates, exists);
}

module.exports = {
  resolveCliPath,
  resolveCorePath,
};
