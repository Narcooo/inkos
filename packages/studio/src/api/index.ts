import { serve } from "@hono/node-server";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.INKOS_STUDIO_PORT ?? "4567", 10);
const projectRoot = process.cwd();
const apiDir = dirname(fileURLToPath(import.meta.url));
const webRootAbsolute = apiDir.includes(`${join("src", "api")}`)
  ? join(apiDir, "..", "..", "dist", "web")
  : join(apiDir, "..", "web");
const staticRoot = relative(projectRoot, webRootAbsolute).replaceAll("\\", "/");

const app = createApp({ projectRoot, staticRoot });

serve({ fetch: app.fetch, port });

process.stdout.write(`InkOS Studio API listening on http://localhost:${port}\n`);
