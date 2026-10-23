import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    // Never the developer's own ~/.acai (accounts, model, the server's frameworks); tests may set their own.
    env: { ACAI_HOME: join(tmpdir(), `acai-test-home-${process.pid}`) },
  },
});
