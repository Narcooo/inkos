import { startStudioServer } from "./server.js";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = resolve(process.argv[2] ?? process.env.INKOS_PROJECT_ROOT ?? process.cwd());
const port = parseInt(process.env.INKOS_STUDIO_PORT ?? "4567", 10);

// Find studio package root (2 levels up from src/api/)
const studioRoot = resolve(__dirname, "../..");
const distDir = join(studioRoot, "dist");

// Auto-build frontend if dist/ doesn't exist
if (!existsSync(join(distDir, "index.html"))) {
  console.log("Building frontend...");
  try {
    execSync("npx vite build", { cwd: studioRoot, stdio: "inherit" });
  } catch {
    console.error("Failed to build frontend. Run 'cd packages/studio && pnpm build' manually.");
    process.exit(1);
  }
}

startStudioServer(root, port, { staticDir: distDir }).catch((e) => {
  console.error("Failed to start studio:", e);
  process.exit(1);
});
