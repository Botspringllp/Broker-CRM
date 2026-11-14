import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 35000,
    setupFiles: ["./tests/integration/setup/integration-env.ts"],
    include: ["tests/integration/**/*.integration.test.ts"],
    fileParallelism: false, // Sequential execution to prevent database transaction collisions
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

