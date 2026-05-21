import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, "..");

// Set default environment variables
const env = {
  ...process.env,
  INKOS_STUDIO_PORT: process.env.INKOS_STUDIO_PORT || "4569",
  INKOS_PROJECT_ROOT: process.env.INKOS_PROJECT_ROOT || "d:\\GitHub\\inkos\\inkos\\my-novel",
};

console.log("Starting InkOS Studio...");
console.log(`  Frontend: http://localhost:4567`);
console.log(`  Backend API: http://localhost:${env.INKOS_STUDIO_PORT}`);

// Start backend server
const server = spawn("npx", ["tsx", "watch", "--clear-screen=false", "src/api/index.ts"], {
  cwd: studioRoot,
  env,
  stdio: "inherit",
  shell: true,
});

// Wait a bit for server to start, then start frontend
setTimeout(() => {
  const client = spawn("npx", ["vite", "--host", "--port", "4567"], {
    cwd: studioRoot,
    env,
    stdio: "inherit",
    shell: true,
  });

  client.on("error", (err) => {
    console.error("Failed to start frontend:", err);
    server.kill();
    process.exit(1);
  });

  client.on("exit", (code) => {
    server.kill();
    process.exit(code ?? 0);
  });
}, 1000);

server.on("error", (err) => {
  console.error("Failed to start backend server:", err);
  process.exit(1);
});

server.on("exit", (code) => {
  process.exit(code ?? 0);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill();
  process.exit(0);
});
