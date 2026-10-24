import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // Flow tests perform durable filesystem transactions. Bound concurrent
    // workers so disk contention does not consume their individual time budgets.
    maxWorkers: 2,
    // Some pipeline-runner tests can approach Vitest's default 5s timeout
    // under full parallel runs; keep this high enough to avoid false kills.
    testTimeout: 30_000,
  },
});
