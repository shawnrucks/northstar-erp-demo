import path from "node:path";
import { defineConfig } from "vitest/config";

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  test: {
    environment: "node",
    env: {
      NORTHSTAR_DATABASE_PATH: path.resolve(
        root,
        ".test-data/vitest/data/northstar.sqlite3",
      ),
    },
    fileParallelism: false,
    globalSetup: ["./tests/support/vitest.global.ts"],
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    pool: "forks",
    maxWorkers: 1,
  },
});
