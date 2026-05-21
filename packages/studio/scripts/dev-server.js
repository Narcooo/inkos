import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, "..");

// Set default environment variables
const env = {
  ...process.env,
  INKOS_STUDIO_PORT: process.env.INKOS_STUDIO_PORT || "4569",
  INKOS_PROJECT_ROOT: process.env.INKOS_PROJECT_ROOT || "../..",
};

console.log("Starting backend server...");
console.log(`  API will be available at: http://localhost:${env.INKOS_STUDIO_PORT}`);

const server = spawn("npx", ["tsx", "watch", "src/api/index.ts"], {
  cwd: studioRoot,
  env,
  stdio: "inherit",
  shell: true,
});

server.on("error", (err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

server.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill();
  process.exit(0);
});
