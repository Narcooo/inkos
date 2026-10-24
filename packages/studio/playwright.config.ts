import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // Run specs serially against the single shared dev server. The authoring
  // agent flow streams a long SSE turn; with parallel workers, concurrent
  // specs hammering the one server starve that turn into a 60s timeout (the
  // spec passes alone but flakes in a parallel full run). Serial is both
  // reliable and faster here (one backend, no contention).
  workers: 1,
  use: {
    baseURL: "http://localhost:4580",
    headless: true,
    screenshot: "only-on-failure",
  },
  // Ports 4580/4581 are dedicated to E2E to avoid conflict with the dev server.
  webServer: {
    // Playwright starts webServer before globalSetup. Build before either server
    // imports Core so cleaning dist cannot race API startup or Vite transforms.
    command: "pnpm --filter @actalk/inkos-core build && (INKOS_STUDIO_PORT=4581 INKOS_PROJECT_ROOT=\"${INKOS_E2E_PROJECT_ROOT:-../../test-project}\" tsx watch --clear-screen=false src/api/index.ts & INKOS_STUDIO_PORT=4581 vite --host --port 4580 ; kill %1 2>/dev/null)",
    url: "http://localhost:4580/api/v1/project",
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: ".",
  },
});
