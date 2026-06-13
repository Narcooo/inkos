import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@actalk/inkos-core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
